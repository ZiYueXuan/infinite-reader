import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { isAnnotationMindmap } from '../../../shared/mindmap';
import type { MindmapIndex, MindmapResult, MindmapState } from '../../../shared/mindmap';
import { requireAuth, type AppEnv } from '../auth';
import { ownedBook } from './books';
import { enforceRateLimit, HttpError, newId, parseBody, sha256Hex } from '../lib/util';
import { annotationMindmapSource, mindmapSource } from '../mindmap/source';
import { generateMindmap } from '../mindmap/generate';
import { parseMindmapContent, type MindmapOutput } from '../mindmap/output';

export const mindmaps = new Hono<AppEnv>();
mindmaps.use('*', requireAuth);
mindmaps.use('*', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: { code: 'too_large', message: 'Request too large' } }, 413) }));
const targetSchema = z.string().min(1).max(1500);
interface Row { status: 'running' | 'ready' | 'failed'; result: string | null; started_at: number; operation_id: string }
const prefix = (user: string, book: string) => `users/${user}/books/${book}/mindmaps/`;

// One lightweight read for the entire TOC; never load diagrams or invoke a model.
mindmaps.get('/:id/mindmaps', async c => {
  const book = await ownedBook(c, c.req.param('id')), user = c.get('user').id;
  const rows = await c.env.DB.prepare("SELECT target, status, started_at, result IS NOT NULL AS saved FROM mindmaps WHERE user_id = ? AND book_id = ? AND status IN ('ready', 'running')")
    .bind(user, book.id).all<{ target: string; status: string; started_at: number; saved: number }>();
  const index: MindmapIndex = { readyTargets: [], pending: false };
  const recovery = new Set<string>();
  if (rows.results.some(row => row.status === 'running' && !row.saved)) {
    let cursor: string | undefined;
    do {
      const page = await c.env.BOOKS.list({ prefix: prefix(user, book.id), cursor });
      page.objects.forEach(object => recovery.add(object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  for (const row of rows.results) {
    if (row.saved || recovery.has(`${prefix(user, book.id)}${await sha256Hex(row.target)}.json`)) index.readyTargets.push(row.target);
    else if (row.status === 'running' && Date.now() - row.started_at <= 150_000) index.pending = true;
  }
  return c.json(index);
});

export async function deleteMindmaps(bucket: R2Bucket, user: string, book: string) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: prefix(user, book), cursor });
    if (page.objects.length) await bucket.delete(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

mindmaps.on(['GET', 'POST'], '/:id/mindmap', async c => {
  const book = await ownedBook(c, c.req.param('id')), user = c.get('user').id;
  const queried = c.req.method === 'GET' ? targetSchema.safeParse(c.req.query('target')) : null;
  if (queried && !queried.success) throw new HttpError(400, 'invalid_target', 'Invalid navigation target');
  const input = c.req.method === 'POST'
    ? await parseBody(c, z.object({ target: targetSchema, retry: z.boolean().default(false) }).strict())
    : { target: queried!.data!, retry: false };
  const target = input.target;
  const annotationId = isAnnotationMindmap(target) ? target.slice('annotation:'.length) : null;
  if (annotationId !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(annotationId)) throw new HttpError(400, 'invalid_target', 'Invalid annotation target');
  const key = `${prefix(user, book.id)}${await sha256Hex(target)}.json`;
  const rejectedKey = key.replace(/\.json$/, '.rejected.json');
  const read = () => c.env.DB.prepare('SELECT status, result, started_at, operation_id FROM mindmaps WHERE user_id = ? AND book_id = ? AND target = ?').bind(user, book.id, target).first<Row>();
  const state = async (row: Row | null): Promise<MindmapState> => {
    if (!row) return { status: 'missing' };
    if (row.result) return { status: 'ready', result: JSON.parse(row.result), cached: true };
    if (row.status === 'running') {
      // A completed result may have survived in R2 while the final D1 update failed.
      const saved = await c.env.BOOKS.get(key);
      if (saved) return { status: 'ready', result: await saved.json<MindmapResult>(), cached: true };
      if (Date.now() - row.started_at > 150_000) return { status: 'interrupted', message: '生成任务中断或保存状态待确认。为避免重复收费，不会自动重新生成，请稍后查看。' };
      return { status: 'running' };
    }
    // Re-run only local parsing after a parser update, never inference on a status read.
    const rejected = await c.env.BOOKS.get(rejectedKey);
    if (rejected) {
      const output = await rejected.json<MindmapOutput>();
      if (output.operationId === row.operation_id) {
        let recovered: MindmapResult | undefined;
        try { recovered = { tree: parseMindmapContent(output.content), title: output.title, model: output.model, generatedAt: output.generatedAt, operationId: output.operationId, ...(output.source ? { source: output.source } : {}) }; }
        catch { /* Still invalid: retain the original response for diagnosis. */ }
        if (recovered) {
          const saved = await c.env.DB.prepare("UPDATE mindmaps SET status = 'ready', result = ? WHERE user_id = ? AND book_id = ? AND target = ? AND status = 'failed' AND operation_id = ?")
            .bind(JSON.stringify(recovered), user, book.id, target, row.operation_id).run();
          if (saved.meta.changes === 1) return { status: 'ready', result: recovered, cached: true };
          return state(await read());
        }
      }
    }
    const usage = await c.env.DB.prepare("SELECT error_code FROM ai_usage WHERE user_id = ? AND book_id = ? AND operation_id = ? AND feature IN ('mindmap', 'highlight_mindmap') ORDER BY started_at DESC LIMIT 1")
      .bind(user, book.id, row.operation_id).first<{ error_code: string | null }>();
    const code = usage?.error_code;
    const reason = code === 'mindmap_timeout' ? '上次生成超时。' : code === 'mindmap_truncated' ? '上次导图输出达到长度上限。'
      : code === 'mindmap_provider' ? '上次模型服务暂时不可用。'
      : code === 'mindmap_invalid' || ['mindmap_json', 'mindmap_node', 'mindmap_label', 'mindmap_children', 'mindmap_limits', 'mindmap_empty'].includes(code ?? '') ? '模型已返回内容，但导图结构校验未通过。'
      : '上次生成未完成。';
    return { status: 'failed', message: reason + '已记录可获得的用量；手动重试可能产生新的费用。' };
  };
  const previous = await read(), current = await state(previous);
  if (c.req.method === 'GET' || current.status === 'ready' || current.status === 'running' || current.status === 'interrupted' || current.status === 'failed' && !input.retry) return c.json(current);
  // Read only the owned, persisted annotation. Never accept passage text in this request.
  let excerpt: ReturnType<typeof annotationMindmapSource> | undefined;
  if (annotationId !== null) {
    const annotation = await c.env.DB.prepare('SELECT text FROM annotations WHERE id = ? AND user_id = ? AND book_id = ?').bind(annotationId, user, book.id).first<{ text: string | null }>();
    if (!annotation) throw new HttpError(404, 'annotation_not_synced', '未找到已同步的划线，请等待划线保存后重试。');
    excerpt = annotationMindmapSource(annotationId, annotation.text);
  }
  if (!c.env.DEEPSEEK_API_KEY) throw new HttpError(503, 'llm_not_configured', '思维导图服务尚未配置。');
  const operation = newId(), started = Date.now();
  // A durable compare-and-set excludes other requests, tabs and Worker isolates.
  const claim = previous
    ? await c.env.DB.prepare("UPDATE mindmaps SET status = 'running', operation_id = ?, started_at = ? WHERE user_id = ? AND book_id = ? AND target = ? AND status = 'failed' AND operation_id = ?").bind(operation, started, user, book.id, target, previous.operation_id).run()
    : await c.env.DB.prepare("INSERT OR IGNORE INTO mindmaps (user_id, book_id, target, operation_id, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)").bind(user, book.id, target, operation, started).run();
  if (claim.meta.changes !== 1) return c.json(await state(await read()));
  const env = c.env;
  const work = (async (): Promise<MindmapState> => {
    let result: MindmapResult;
    try {
      await enforceRateLimit(env.DB, `mindmap:minute:${user}`, 6, 60);
      await enforceRateLimit(env.DB, `mindmap:day:${user}`, 40, 86400);
      let source: { title: string; text: string; source?: MindmapResult['source'] };
      if (excerpt) source = excerpt;
      else {
        const head = await env.BOOKS.head(book.file_key);
        if (!head) throw new HttpError(404, 'book_file_missing', '原书文件不存在。');
        if (head.size > 50 * 1024 * 1024) throw new HttpError(413, 'book_too_large', '此书文件过大，暂不支持生成思维导图。');
        const file = await env.BOOKS.get(book.file_key);
        if (!file) throw new HttpError(404, 'book_file_missing', '原书文件不存在。');
        source = mindmapSource(new Uint8Array(await file.arrayBuffer()), target);
      }
      result = await generateMindmap(env, source, { operationId: operation, userId: user, bookId: book.id }, async output => {
        await env.BOOKS.put(rejectedKey, JSON.stringify(output), { httpMetadata: { contentType: 'application/json' } });
        const present = await env.DB.prepare("SELECT id FROM books WHERE id = ? AND user_id = ? AND status != 'deleting'").bind(book.id, user).first().catch(() => undefined);
        if (present === null) { await env.BOOKS.delete(rejectedKey); throw new HttpError(404, 'not_found', 'Book not found'); }
      });
    } catch (error) {
      // Only known completed failures can be manually retried. Lost Workers keep their lock.
      await env.DB.prepare("UPDATE mindmaps SET status = 'failed' WHERE user_id = ? AND book_id = ? AND target = ? AND operation_id = ?").bind(user, book.id, target, operation).run();
      throw error;
    }
    const exists = () => env.DB.prepare("SELECT id FROM books WHERE id = ? AND user_id = ? AND status != 'deleting'").bind(book.id, user).first();
    const serialized = JSON.stringify(result);
    // Persist in D1; R2 is the recovery path if storage fails after a paid completion.
    try {
      const saved = await env.DB.prepare("UPDATE mindmaps SET status = 'ready', result = ? WHERE user_id = ? AND book_id = ? AND target = ? AND operation_id = ? AND EXISTS (SELECT 1 FROM books WHERE id = ? AND status != 'deleting')").bind(serialized, user, book.id, target, operation, book.id).run();
      if (saved.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Book not found');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      await env.BOOKS.put(key, serialized, { httpMetadata: { contentType: 'application/json' } });
      // Preserve the recovery object if D1 itself is unavailable; it is only readable
      // through ownedBook, and book deletion cleans the whole private prefix.
      const present = await exists().catch(() => undefined);
      if (present === null) { await env.BOOKS.delete(key); throw new HttpError(404, 'not_found', 'Book not found'); }
    }
    return { status: 'ready', result, cached: false };
  })();
  c.executionCtx.waitUntil(work.catch(() => undefined));
  return c.json(await work);
});
