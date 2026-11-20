import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireAuth } from "../auth";
import { HttpError, newId, now, parseBody, safeJson } from "../lib/util";
import { ownedBook } from "./books";
import { agentRequest, clearBookAgents } from "../agent/client";

export const marks = new Hono<AppEnv>();
marks.use("*", requireAuth);

const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/, "color must be a hex or named color");

/**
 * Text-range anchor. The shape is intentionally open (the reader engine owns it); it must be a
 * non-empty JSON object under 8 KB. Recommended keys: href, spineIndex, cfi, start, end,
 * startPath/startOffset/endPath/endOffset, quote, prefix, suffix.
 */
const anchor = z
  .looseObject({})
  .refine((a) => Object.keys(a).length > 0, "anchor must not be empty")
  .refine((a) => JSON.stringify(a).length <= 8192, "anchor too large");

const idField = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

const annCreate = z.object({
  id: idField.optional(),
    // judou: a reader-added clause mark; it has no colour of its own but shares the annotation table.
    kind: z.enum(["highlight", "underline", "judou"]),
  color: color.default("#ffe066"),
  anchor,
  text: z.string().max(20000).nullish(),
  noteId: idField.nullish(),
});
const annPatch = z.object({
    kind: z.enum(["highlight", "underline", "judou"]).optional(),
  color: color.optional(),
  noteId: idField.nullable().optional(),
});

interface AnnRow {
  id: string;
  book_id: string;
  kind: string;
  color: string;
  anchor: string;
  text: string | null;
  note_id: string | null;
  created_at: number;
  updated_at: number;
}
const annOut = (r: AnnRow) => ({
  id: r.id,
  bookId: r.book_id,
  kind: r.kind,
  color: r.color,
  anchor: safeJson(r.anchor),
  text: r.text,
  noteId: r.note_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const since = (c: { req: { query: (k: string) => string | undefined } }) => {
  const n = Number(c.req.query("since") ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

marks.get("/:bookId/annotations", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM annotations WHERE book_id = ?1 AND user_id = ?2 AND updated_at > ?3 ORDER BY created_at",
  )
    .bind(book.id, c.get("user").id, since(c))
    .all<AnnRow>();
  return c.json({ annotations: rows.results.map(annOut) });
});

marks.post("/:bookId/annotations", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const b = await parseBody(c, annCreate);
  const id = b.id ?? newId();
  const t = now();
  const exists = await c.env.DB.prepare("SELECT 1 AS x FROM annotations WHERE id = ?1").bind(id).first();
  if (exists) throw new HttpError(409, "conflict", "Annotation id already exists");
  await c.env.DB.prepare(
    `INSERT INTO annotations (id, book_id, user_id, kind, color, anchor, text, note_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
  )
    .bind(id, book.id, c.get("user").id, b.kind, b.color, JSON.stringify(b.anchor), b.text ?? null, b.noteId ?? null, t)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM annotations WHERE id = ?1").bind(id).first<AnnRow>();
  return c.json({ annotation: annOut(row!) }, 201);
});

async function ownedAnn(c: Parameters<typeof ownedBook>[0] & { req: { param: (k: string) => string } }, bookId: string, id: string) {
  const row = await c.env.DB.prepare("SELECT * FROM annotations WHERE id = ?1 AND book_id = ?2 AND user_id = ?3")
    .bind(id, bookId, c.get("user").id)
    .first<AnnRow>();
  if (!row) throw new HttpError(404, "not_found", "Annotation not found");
  return row;
}

marks.patch("/:bookId/annotations/:id", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const cur = await ownedAnn(c, book.id, c.req.param("id"));
  const b = await parseBody(c, annPatch);
  await c.env.DB.prepare("UPDATE annotations SET kind = ?2, color = ?3, note_id = ?4, updated_at = ?5 WHERE id = ?1")
    .bind(cur.id, b.kind ?? cur.kind, b.color ?? cur.color, b.noteId === undefined ? cur.note_id : b.noteId, now())
    .run();
  return c.json({ annotation: annOut(await ownedAnn(c, book.id, cur.id)) });
});

marks.delete("/:bookId/annotations/:id", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const cur = await ownedAnn(c, book.id, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM annotations WHERE id = ?1").bind(cur.id).run();
  return c.json({ ok: true });
});

// ---- Sticky notes (canvas) ------------------------------------------------

const num = z.number().finite().min(-1e7).max(1e7);
const noteCreate = z.object({
  id: idField.optional(),
  text: z.string().max(20000).default(""),
  color: color.default("#fff3a3"),
  x: num.default(0),
  y: num.default(0),
  width: num.positive().nullish(),
  height: num.positive().nullish(),
  z: z.number().int().min(-1e6).max(1e6).default(0),
  annotationId: idField.nullish(),
  anchor: anchor.nullish(),
});
const notePatch = z.object({
  text: z.string().max(20000).optional(),
  color: color.optional(),
  x: num.optional(),
  y: num.optional(),
  width: num.positive().nullable().optional(),
  height: num.positive().nullable().optional(),
  z: z.number().int().min(-1e6).max(1e6).optional(),
  annotationId: idField.nullable().optional(),
  anchor: anchor.nullable().optional(),
});

interface NoteRow {
  id: string;
  book_id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  z: number;
  annotation_id: string | null;
  anchor: string | null;
  created_at: number;
  updated_at: number;
}
const noteOut = (r: NoteRow) => ({
  id: r.id,
  bookId: r.book_id,
  text: r.text,
  color: r.color,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  z: r.z,
  annotationId: r.annotation_id,
  anchor: safeJson(r.anchor),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

marks.get("/:bookId/notes", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM notes WHERE book_id = ?1 AND user_id = ?2 AND updated_at > ?3 ORDER BY z, created_at",
  )
    .bind(book.id, c.get("user").id, since(c))
    .all<NoteRow>();
  return c.json({ notes: rows.results.map(noteOut) });
});

marks.post("/:bookId/notes", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const b = await parseBody(c, noteCreate);
  const id = b.id ?? newId();
  const t = now();
  const exists = await c.env.DB.prepare("SELECT 1 AS x FROM notes WHERE id = ?1").bind(id).first();
  if (exists) throw new HttpError(409, "conflict", "Note id already exists");
  await c.env.DB.prepare(
    `INSERT INTO notes (id, book_id, user_id, text, color, x, y, width, height, z, annotation_id, anchor, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
  )
    .bind(
      id,
      book.id,
      c.get("user").id,
      b.text,
      b.color,
      b.x,
      b.y,
      b.width ?? null,
      b.height ?? null,
      b.z,
      b.annotationId ?? null,
      b.anchor ? JSON.stringify(b.anchor) : null,
      t,
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM notes WHERE id = ?1").bind(id).first<NoteRow>();
  return c.json({ note: noteOut(row!) }, 201);
});

async function ownedNote(c: Parameters<typeof ownedBook>[0], bookId: string, id: string) {
  const row = await c.env.DB.prepare("SELECT * FROM notes WHERE id = ?1 AND book_id = ?2 AND user_id = ?3")
    .bind(id, bookId, c.get("user").id)
    .first<NoteRow>();
  if (!row) throw new HttpError(404, "not_found", "Note not found");
  return row;
}

marks.patch("/:bookId/notes/:id", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const cur = await ownedNote(c, book.id, c.req.param("id"));
  const b = await parseBody(c, notePatch);
  await c.env.DB.prepare(
    `UPDATE notes SET text = ?2, color = ?3, x = ?4, y = ?5, width = ?6, height = ?7, z = ?8,
       annotation_id = ?9, anchor = ?10, updated_at = ?11 WHERE id = ?1`,
  )
    .bind(
      cur.id,
      b.text ?? cur.text,
      b.color ?? cur.color,
      b.x ?? cur.x,
      b.y ?? cur.y,
      b.width === undefined ? cur.width : b.width,
      b.height === undefined ? cur.height : b.height,
      b.z ?? cur.z,
      b.annotationId === undefined ? cur.annotation_id : b.annotationId,
      b.anchor === undefined ? cur.anchor : b.anchor ? JSON.stringify(b.anchor) : null,
      now(),
    )
    .run();
  return c.json({ note: noteOut(await ownedNote(c, book.id, cur.id)) });
});

marks.delete("/:bookId/notes/:id", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const cur = await ownedNote(c, book.id, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM notes WHERE id = ?1").bind(cur.id).run();
  return c.json({ ok: true });
});

// ---- Chat history ---------------------------------------------------------

marks.get("/:bookId/chat", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const thread = c.req.query("threadId") ?? "default";
  const state = await agentRequest(c.env, { userId: c.get("user").id, bookId: book.id, threadId: thread }, "/status");
  if (!state.ok) throw new HttpError(503, "agent_unavailable", "Could not restore conversation");
  const { pending } = await state.json<{ pending: { operationId: string; messageId: string; userMessageId: string } | null }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, thread_id, role, content, selection, citations, model, created_at FROM chat_messages
     WHERE book_id = ?1 AND user_id = ?2 AND thread_id = ?3 ORDER BY created_at, rowid`,
  )
    .bind(book.id, c.get("user").id, thread)
    .all<{
      id: string;
      thread_id: string;
      role: string;
      content: string;
      selection: string | null;
      citations: string | null;
      model: string | null;
      created_at: number;
    }>();
  return c.json({
    pending,
    messages: rows.results.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      role: r.role,
      content: r.content,
      selection: safeJson(r.selection),
      citations: safeJson(r.citations) ?? [],
      model: r.model,
      createdAt: r.created_at,
    })),
  });
});

marks.delete("/:bookId/chat", async (c) => {
  const book = await ownedBook(c, c.req.param("bookId"));
  const thread = c.req.query("threadId");
  await clearBookAgents(c.env, c.get("user").id, book.id, thread);
  if (thread) {
    await c.env.DB.prepare("DELETE FROM chat_messages WHERE book_id = ?1 AND user_id = ?2 AND thread_id = ?3")
      .bind(book.id, c.get("user").id, thread)
      .run();
  } else {
    await c.env.DB.prepare("DELETE FROM chat_messages WHERE book_id = ?1 AND user_id = ?2")
      .bind(book.id, c.get("user").id)
      .run();
  }
  return c.json({ ok: true });
});
