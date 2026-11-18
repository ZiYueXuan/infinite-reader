import { createCostMeter, unmeteredEnv } from '../lib/costMeter';
import { chunkText } from "./chunk";
import { parseEpub } from "./epub";
import { newId, now } from "../lib/util";
import { startAiCall, type AiUsageContext } from "../lib/aiUsage";

export type IndexMessage =
  | { type: "parse"; bookId: string; fileKey?: string }
  | { type: "metadata"; bookId: string }
  | { type: "embed"; bookId: string; from: number; to: number };

export const EMBED_BATCH = 32;
const INSERT_ROWS = 11; // 9 bound params per row, D1 limit is 100 per statement
const STATEMENTS_PER_BATCH = 40;

export async function embedTexts(env: Env, texts: string[], context: AiUsageContext & { feature: "index_embedding" | "retrieval_embedding" }): Promise<number[][]> {
  const usage = await startAiCall(env, { ...context, provider: "cloudflare", model: env.EMBEDDING_MODEL, inputCharacters: texts.reduce((n, text) => n + Array.from(text).length, 0) });
  let errorCode: string | undefined;
  try {
    const res = (await env.AI.run(env.EMBEDDING_MODEL as keyof AiModels, { text: texts } as never)) as { data?: number[][] };
    usage.observe(res);
    if (!res?.data || res.data.length !== texts.length) {
      errorCode = "embedding_invalid_result";
      throw new Error("embedding model returned unexpected shape");
    }
    return res.data;
  } catch (error) {
    errorCode ??= "embedding_upstream";
    throw error;
  } finally {
    await usage.finish({ status: errorCode ? "failed" : "succeeded", errorCode });
  }
}

async function setStatus(env: Env, bookId: string, status: string, error: string | null = null) {
  await env.DB.prepare("UPDATE books SET status = ?2, error = ?3, updated_at = ?4 WHERE id = ?1 AND status != 'deleting'")
    .bind(bookId, status, error, now())
    .run();
}

export async function markFailed(env: Env, bookId: string, error: string) {
  await setStatus(env, bookId, "failed", error.slice(0, 500));
}

/** Remove a book's chunks from D1 and its vectors from Vectorize (the namespace is the book id). */
export async function deleteBookIndex(env: Env, bookId: string) {
  const ids: string[] = [];
  const rows = await env.DB.prepare("SELECT id FROM chunks WHERE book_id = ?1").bind(bookId).all<{ id: string }>();
  for (const r of rows.results) ids.push(r.id);
  for (let i = 0; i < ids.length; i += 100) {
    await env.VECTORIZE.deleteByIds(ids.slice(i, i + 100));
  }
  await env.DB.prepare("DELETE FROM chunks WHERE book_id = ?1").bind(bookId).run();
}

async function activeBook(env: Env, bookId: string) {
  return !!await env.DB.prepare("SELECT id FROM books WHERE id = ?1 AND status != 'deleting'").bind(bookId).first();
}

async function parseBook(env: Env, bookId: string, fileKey?: string): Promise<IndexMessage[]> {
  const book = await env.DB.prepare("SELECT id, file_key, title, filename FROM books WHERE id = ?1 AND status != 'deleting'")
    .bind(bookId)
    .first<{ id: string; file_key: string; title: string; filename: string | null }>();
  if (!book) {
    if (fileKey) await env.BOOKS.delete(`${fileKey}.cover`);
    await deleteBookIndex(env, bookId);
    return [];
  }
  try {
    await setStatus(env, bookId, "parsing");

    const obj = await env.BOOKS.get(book.file_key);
    if (!obj) throw new Error("uploaded file missing from R2");
    const parsed = parseEpub(new Uint8Array(await obj.arrayBuffer()));
    if (parsed.chapters.length === 0) throw new Error("no readable text found in EPUB");

    await deleteBookIndex(env, bookId);

    let coverKey: string | null = null;
    if (parsed.cover) {
      coverKey = `${book.file_key}.cover`;
      await env.BOOKS.put(coverKey, parsed.cover.bytes, { httpMetadata: { contentType: parsed.cover.mime } });
    }

    const rows: unknown[][] = [];
    let ordinal = 0;
    for (const ch of parsed.chapters) {
      for (const c of chunkText(ch.text)) {
        rows.push([`${bookId}:${ordinal}`, bookId, ordinal, ch.index, ch.title, ch.href, c.start, c.end, c.text]);
        ordinal++;
      }
    }

    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < rows.length; i += INSERT_ROWS) {
      const part = rows.slice(i, i + INSERT_ROWS);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO chunks (id, book_id, ordinal, chapter_index, chapter_title, chapter_href, char_start, char_end, text) VALUES ${part
            .map(() => "(?,?,?,?,?,?,?,?,?)")
            .join(",")}`,
        ).bind(...part.flat()),
      );
    }
    for (let i = 0; i < stmts.length; i += STATEMENTS_PER_BATCH) {
      await env.DB.batch(stmts.slice(i, i + STATEMENTS_PER_BATCH));
    }

    await env.DB.prepare(
      `UPDATE books SET status = 'indexing', error = NULL, title = ?2, author = ?3, language = ?4, description = ?5,
         toc = ?6, cover_key = ?7, chapter_count = ?8, chunk_count = ?9, indexed_chunks = 0, updated_at = ?10,
         bibliography = ?11, bibliography_attempted_at = ?10, bibliography_error = NULL WHERE id = ?1 AND status != 'deleting'`,
    )
      .bind(
        bookId,
        parsed.title ?? book.title,
        parsed.author,
        parsed.language,
        parsed.description?.slice(0, 2000) ?? null,
        JSON.stringify(parsed.toc.map((t) => ({ ...t, chapter: chapterIndexFor(parsed.chapters, t.href) }))),
        coverKey,
        parsed.chapters.length,
        rows.length,
        now(),
        JSON.stringify(parsed.bibliography),
      )
      .run();

    const msgs: IndexMessage[] = [];
    for (let from = 0; from < rows.length; from += EMBED_BATCH) {
      msgs.push({ type: "embed", bookId, from, to: Math.min(rows.length, from + EMBED_BATCH) });
    }
    return await activeBook(env, bookId) ? msgs : [];
  } finally {
    // A deletion can race parsing after its initial ownership check.
    if (!await activeBook(env, bookId)) {
      await env.BOOKS.delete(`${book.file_key}.cover`);
      await deleteBookIndex(env, bookId);
    }
  }
}

function chapterIndexFor(chapters: { index: number; href: string }[], href: string): number | null {
  const base = href.split("#")[0];
  return chapters.find((c) => c.href === base)?.index ?? null;
}

async function embedBatch(env: Env, bookId: string, from: number, to: number): Promise<void> {
  const book = await env.DB.prepare("SELECT user_id FROM books WHERE id = ?1 AND status != 'deleting'").bind(bookId).first<{ user_id: string }>();
  // An interrupted job may be retried after the book row has already gone.
  if (!book) {
    if (to > from) await env.VECTORIZE.deleteByIds(Array.from({ length: to - from }, (_, i) => `${bookId}:${from + i}`));
    return;
  }
  const rows = await env.DB.prepare(
    `SELECT id, ordinal, chapter_index, text FROM chunks
     WHERE book_id = ?1 AND ordinal >= ?2 AND ordinal < ?3 AND embedded = 0 ORDER BY ordinal`,
  )
    .bind(bookId, from, to)
    .all<{ id: string; ordinal: number; chapter_index: number; text: string }>();
  if (rows.results.length > 0) {
    try {
      const vectors = await embedTexts(
        env,
        rows.results.map((r) => r.text),
        { operationId: newId(), userId: book.user_id, bookId, feature: "index_embedding" },
      );
      await env.VECTORIZE.upsert(
        rows.results.map((r, i) => ({
          id: r.id,
          namespace: bookId,
          values: vectors[i]!,
          metadata: { ordinal: r.ordinal, chapter: r.chapter_index },
        })),
      );
      await env.DB.prepare(
        `UPDATE chunks SET embedded = 1 WHERE id IN (${rows.results.map(() => "?").join(",")})`,
      )
        .bind(...rows.results.map((r) => r.id))
        .run();
    } finally {
      if (!await activeBook(env, bookId)) await env.VECTORIZE.deleteByIds(rows.results.map((r) => r.id));
    }
  }
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE book_id = ?1 AND embedded = 0")
    .bind(bookId)
    .first<{ n: number }>();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE book_id = ?1")
    .bind(bookId)
    .first<{ n: number }>();
  const done = (total?.n ?? 0) - (left?.n ?? 0);
  await env.DB.prepare(
    `UPDATE books SET indexed_chunks = ?2, updated_at = ?3, status = CASE WHEN ?4 = 0 AND status = 'indexing' THEN 'ready' ELSE status END
     WHERE id = ?1 AND status != 'deleting'`,
  )
    .bind(bookId, done, now(), left?.n ?? 0)
    .run();
}

/** Process one message; returns follow-up messages to enqueue. */
export async function handleIndexMessage(env: Env, msg: IndexMessage): Promise<IndexMessage[]> {
  const root = unmeteredEnv(env), started = Date.now();
  const owner = await root.DB.prepare('SELECT user_id FROM books WHERE id = ?').bind(msg.bookId).first<{ user_id: string }>();
  const meter = createCostMeter(root);
  let status = 'succeeded';
  try {
    if (msg.type === 'metadata') { await extractStoredBibliography(meter.env, msg.bookId); return []; }
    if (msg.type === 'parse') return await parseBook(meter.env, msg.bookId, msg.fileKey);
    await embedBatch(meter.env, msg.bookId, msg.from, msg.to);
    return [];
  } catch (error) { status = 'failed'; throw error; }
  finally { if (owner) await meter.finish(owner.user_id, msg.bookId, msg.type === 'metadata' ? '提取书籍出版信息' : msg.type === 'parse' ? '后台解析书籍' : '后台索引批次', started, status); }
}

/** Metadata-only backfill: no chunks, vectors, marks, display fields or reading status are changed. */
async function extractStoredBibliography(env: Env, bookId: string) {
  const book = await env.DB.prepare("SELECT file_key FROM books WHERE id = ? AND status = 'ready' AND bibliography IS NULL")
    .bind(bookId).first<{ file_key: string }>();
  if (!book) return;
  try {
    const file = await env.BOOKS.get(book.file_key);
    if (!file) throw new Error('file_missing');
    const { bibliography } = parseEpub(new Uint8Array(await file.arrayBuffer()), { skipCover: true });
    await env.DB.prepare("UPDATE books SET bibliography = ?, bibliography_error = NULL WHERE id = ? AND status = 'ready' AND bibliography IS NULL")
      .bind(JSON.stringify(bibliography), bookId).run();
  } catch (error) {
    await env.DB.prepare("UPDATE books SET bibliography_error = 'extraction_failed' WHERE id = ? AND status = 'ready' AND bibliography IS NULL").bind(bookId).run();
    throw error;
  }
}

/** Claim at most once per five minutes; a failed backfill must never prevent reading. */
export async function requestBibliography(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, bookId: string) {
  const t = now();
  const claim = await env.DB.prepare(`UPDATE books SET bibliography_attempted_at = ?, bibliography_error = NULL
    WHERE id = ? AND status = 'ready' AND bibliography IS NULL
    AND (bibliography_attempted_at IS NULL OR bibliography_attempted_at < ?)`)
    .bind(t, bookId, t - 5 * 60 * 1000).run();
  if (claim.meta.changes) enqueue(env, ctx, [{ type: 'metadata', bookId }]);
}

/** Send messages to the queue, or (no queue bound) process them inline under `ctx.waitUntil`. */
export function enqueue(env: Env, ctx: Pick<ExecutionContext, "waitUntil">, msgs: IndexMessage[]) {
  if (msgs.length === 0) return;
  if (env.INDEX_QUEUE) {
    ctx.waitUntil(
      (async () => {
        for (let i = 0; i < msgs.length; i += 100) {
          await env.INDEX_QUEUE.sendBatch(msgs.slice(i, i + 100).map((body) => ({ body })));
        }
      })(),
    );
    return;
  }
  ctx.waitUntil(runInline(env, msgs));
}

export async function runInline(env: Env, msgs: IndexMessage[]) {
  const pending = [...msgs];
  while (pending.length) {
    const m = pending.shift()!;
    try {
      pending.push(...(await handleIndexMessage(env, m)));
    } catch (e) {
      if (m.type !== 'metadata') await markFailed(env, m.bookId, e instanceof Error ? e.message : String(e));
      return;
    }
  }
}

export async function indexQueueHandler(batch: MessageBatch<IndexMessage>, env: Env) {
  for (const message of batch.messages) {
    try {
      const follow = await handleIndexMessage(env, message.body);
      for (let i = 0; i < follow.length; i += 100) {
        await env.INDEX_QUEUE.sendBatch(follow.slice(i, i + 100).map((body) => ({ body })));
      }
      message.ack();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({ message: "index job failed", attempt: message.attempts, bookId: message.body.bookId, error: err }));
      if (message.attempts >= 5) {
        if (message.body.type !== 'metadata') await markFailed(env, message.body.bookId, err);
        message.ack();
      } else {
        message.retry({ delaySeconds: Math.min(60, 2 ** message.attempts * 2) });
      }
    }
  }
}
