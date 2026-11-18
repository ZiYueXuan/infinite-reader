import { deleteSlides } from '../slides/jobs';
import { deleteBookList } from '../booklist/jobs';
import { deleteMindmaps } from './mindmaps';
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireAuth } from "../auth";
import { deleteBookIndex, enqueue, requestBibliography } from "../pipeline";
import { deleteAtlasCache } from "../atlas/cache";
import { clearBookAgents } from "../agent/client";
import { HttpError, enforceRateLimit, newId, now, parseBody, safeJson } from "../lib/util";

export const books = new Hono<AppEnv>();
books.use("*", requireAuth);

interface BookRow {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  language: string | null;
  description: string | null;
  bibliography: string | null;
  bibliography_attempted_at: number | null;
  bibliography_error: string | null;
  filename: string | null;
  size_bytes: number;
  file_key: string;
  cover_key: string | null;
  status: string;
  error: string | null;
  chapter_count: number;
  chunk_count: number;
  indexed_chunks: number;
  toc: string | null;
  progress: string | null;
  state: string | null;
  created_at: number;
  updated_at: number;
}

function summary(r: BookRow) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    language: r.language,
    description: r.description,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    hasCover: !!r.cover_key,
    status: r.status,
    error: r.error,
    chapterCount: r.chapter_count,
    chunkCount: r.chunk_count,
    indexedChunks: r.indexed_chunks,
    progress: safeJson(r.progress),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function statusOf(r: BookRow) {
  const pct =
    r.status === "ready"
      ? 100
      : r.status === "indexing" && r.chunk_count > 0
        ? Math.round(10 + (r.indexed_chunks / r.chunk_count) * 90)
        : r.status === "parsing"
          ? 5
          : 0;
  return {
    id: r.id,
    status: r.status,
    error: r.error,
    chapterCount: r.chapter_count,
    chunkCount: r.chunk_count,
    indexedChunks: r.indexed_chunks,
    percent: pct,
    updatedAt: r.updated_at,
  };
}

async function ownedBook(c: { env: Env; get: (k: "user") => { id: string } }, id: string, includeDeleting = false): Promise<BookRow> {
  const row = await c.env.DB.prepare("SELECT * FROM books WHERE id = ?1 AND user_id = ?2")
    .bind(id, c.get("user").id)
    .first<BookRow>();
  if (!row || (row.status === "deleting" && !includeDeleting)) throw new HttpError(404, "not_found", "Book not found");
  return row;
}

export { ownedBook };

const EPUB_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function maxUploadBytes(env: Env): number {
  const mb = Number(env.MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 50) * 1024 * 1024;
}

books.post("/", async (c) => {
  const user = c.get("user");
  const max = maxUploadBytes(c.env);
  await enforceRateLimit(c.env.DB, `upload:${user.id}`, 20, 3600);

  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > max + 1024 * 1024) throw new HttpError(413, "too_large", `File exceeds ${c.env.MAX_UPLOAD_MB} MB`);

  const ctype = c.req.header("content-type") ?? "";
  let data: ArrayBuffer;
  let filename = "book.epub";
  let title: string | undefined;
  if (ctype.startsWith("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "invalid_request", "multipart field `file` is required");
    data = await file.arrayBuffer();
    filename = file.name || filename;
    const t = form.get("title");
    if (typeof t === "string" && t.trim()) title = t.trim().slice(0, 300);
  } else {
    data = await c.req.arrayBuffer();
    const hdr = c.req.header("x-filename");
    if (hdr) {
      try {
        filename = decodeURIComponent(hdr);
      } catch {
        filename = hdr;
      }
    }
  }
  if (data.byteLength === 0) throw new HttpError(400, "empty_file", "Empty upload");
  if (data.byteLength > max) throw new HttpError(413, "too_large", `File exceeds ${c.env.MAX_UPLOAD_MB} MB`);
  const head = new Uint8Array(data, 0, 4);
  if (!EPUB_MAGIC.every((b, i) => head[i] === b)) throw new HttpError(415, "not_epub", "File is not a valid EPUB (zip) archive");

  const id = newId();
  const fileKey = `users/${user.id}/books/${id}.epub`;
  filename = filename.slice(-200);
  await c.env.BOOKS.put(fileKey, data, { httpMetadata: { contentType: "application/epub+zip" } });
  const t = now();
  const fallbackTitle = title ?? (filename.replace(/\.epub$/i, "").trim() || "Untitled");
  await c.env.DB.prepare(
    `INSERT INTO books (id, user_id, title, filename, size_bytes, file_key, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'uploaded', ?7, ?7)`,
  )
    .bind(id, user.id, fallbackTitle, filename, data.byteLength, fileKey, t)
    .run();
  enqueue(c.env, c.executionCtx, [{ type: "parse", bookId: id, fileKey }]);
  const row = await ownedBook(c, id);
  c.set("costBookId", id);
  return c.json({ book: summary(row) }, 202);
});

books.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT id, title, author, language, description, filename, size_bytes,
    cover_key, status, error, chapter_count, chunk_count, indexed_chunks, progress, created_at, updated_at
    FROM books WHERE user_id = ?1 ORDER BY created_at DESC`)
    .bind(c.get("user").id)
    .all<BookRow>();
  return c.json({ books: rows.results.map(summary) });
});

books.get("/:id", async (c) => {
  const r = await ownedBook(c, c.req.param("id"));
  return c.json({
    book: { ...summary(r), toc: safeJson(r.toc) ?? [], state: safeJson(r.state), bibliography: safeJson(r.bibliography) },
  });
});

books.get('/:id/metadata', async (c) => {
  const r = await ownedBook(c, c.req.param('id'));
  return c.json({ bibliography: safeJson(r.bibliography), attemptedAt: r.bibliography_attempted_at,
    error: r.bibliography_error, status: r.bibliography ? 'ready' : r.bibliography_error ? 'failed' : r.bibliography_attempted_at ? 'pending' : 'not_extracted' });
});

// Explicit backfill/retry for old books; cached metadata never triggers paid indexing.
books.post('/:id/metadata', async (c) => {
  const r = await ownedBook(c, c.req.param('id'));
  if (r.bibliography) return c.json({ bibliography: safeJson(r.bibliography), status: 'ready' });
  if (r.status !== 'ready') throw new HttpError(409, 'book_not_ready', 'Wait until the book is ready before extracting metadata');
  await enforceRateLimit(c.env.DB, `metadata:${c.get('user').id}`, 30, 3600);
  await requestBibliography(c.env, c.executionCtx, r.id);
  return c.json({ status: 'pending' }, 202);
});

books.get("/:id/status", async (c) => c.json(statusOf(await ownedBook(c, c.req.param("id")))));

books.get("/:id/file", async (c) => {
  const r = await ownedBook(c, c.req.param("id"));
  if (!r.bibliography && r.status === 'ready') {
    // Avoid backfill/storage failures breaking a successful download.
    c.executionCtx.waitUntil(requestBibliography(c.env, c.executionCtx, r.id).catch(() => {
      console.warn('Book metadata backfill could not be scheduled');
    }));
  }
  const range = c.req.header("range");
  const obj = await c.env.BOOKS.get(r.file_key, range ? { range: c.req.raw.headers } : undefined);
  if (!obj) throw new HttpError(404, "file_missing", "File missing");
  const headers = new Headers({
    "content-type": "application/epub+zip",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    etag: obj.httpEtag,
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.filename ?? "book.epub")}`,
  });
  if ("body" in obj && obj.body) {
    if (range && obj.range && "offset" in obj.range) {
      const off = obj.range.offset ?? 0;
      const len = obj.range.length ?? obj.size - off;
      headers.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
      headers.set("content-length", String(len));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set("content-length", String(obj.size));
    return new Response(obj.body, { headers });
  }
  throw new HttpError(404, "file_missing", "File missing");
});

books.get("/:id/cover", async (c) => {
  const r = await ownedBook(c, c.req.param("id"));
  if (!r.cover_key) throw new HttpError(404, "no_cover", "No cover");
  const obj = await c.env.BOOKS.get(r.cover_key);
  if (!obj) throw new HttpError(404, "no_cover", "No cover");
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "private, max-age=86400",
    },
  });
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().max(300).nullable().optional(),
});

books.patch("/:id", async (c) => {
  const r = await ownedBook(c, c.req.param("id"));
  const b = await parseBody(c, patchSchema);
  await c.env.DB.prepare("UPDATE books SET title = ?2, author = ?3, updated_at = ?4 WHERE id = ?1")
    .bind(r.id, b.title ?? r.title, b.author === undefined ? r.author : b.author, now())
    .run();
  return c.json({ book: summary(await ownedBook(c, r.id)) });
});

const progressSchema = z.object({
  location: z.unknown().optional(),
  percent: z.number().min(0).max(100).optional(),
  chapterIndex: z.number().int().min(0).optional(),
});

books.put("/:id/progress", async (c) => {
  const r = await ownedBook(c, c.req.param("id"));
  const b = await parseBody(c, progressSchema);
  const value = JSON.stringify({ ...b, updatedAt: now() });
  if (value.length > 8192) throw new HttpError(413, "too_large", "progress too large");
  await c.env.DB.prepare("UPDATE books SET progress = ?2 WHERE id = ?1").bind(r.id, value).run();
  return c.json({ ok: true, progress: JSON.parse(value) });
});

books.put("/:id/state", async (c) => {
  const r = await ownedBook(c, c.req.param("id"));
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be JSON");
  }
  const value = JSON.stringify(raw ?? null);
  if (value.length > 256 * 1024) throw new HttpError(413, "too_large", "state exceeds 256 KB");
  await c.env.DB.prepare("UPDATE books SET state = ?2, updated_at = ?3 WHERE id = ?1").bind(r.id, value, now()).run();
  return c.json({ ok: true });
});

books.post("/:id/reindex", async (c) => {
  const r = await ownedBook(c, c.req.param("id"));
  await c.env.DB.prepare("UPDATE books SET status = 'uploaded', error = NULL, indexed_chunks = 0, updated_at = ?2 WHERE id = ?1 AND status != 'deleting'")
    .bind(r.id, now())
    .run();
  enqueue(c.env, c.executionCtx, [{ type: "parse", bookId: r.id, fileKey: r.file_key }]);
  return c.json({ ok: true }, 202);
});

books.delete("/:id", async (c) => {
  let r = await ownedBook(c, c.req.param("id"), true);
  // Keep the row until every external cleanup succeeds, so a failed deletion can be retried.
  await c.env.DB.prepare("UPDATE books SET status = 'deleting', updated_at = ?2 WHERE id = ?1").bind(r.id, now()).run();
  r = await ownedBook(c, r.id, true);
  await clearBookAgents(c.env, r.user_id, r.id);
  await deleteBookIndex(c.env, r.id);
  await c.env.BOOKS.delete([...new Set([r.file_key, `${r.file_key}.cover`, ...(r.cover_key ? [r.cover_key] : [])])]);
  await deleteAtlasCache(c.env.BOOKS, r.user_id, r.id);
  await deleteMindmaps(c.env.BOOKS, r.user_id, r.id);
  await deleteSlides(c.env.BOOKS, r.user_id, r.id);
  await deleteBookList(c.env.BOOKS, r.user_id, r.id);
  await c.env.DB.prepare("DELETE FROM books WHERE id = ?1 AND user_id = ?2").bind(r.id, r.user_id).run();
  return c.json({ ok: true });
});
