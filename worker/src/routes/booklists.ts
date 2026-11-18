import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { requireAuth, type AppEnv } from '../auth';
import { enforceRateLimit, HttpError, newId, parseBody } from '../lib/util';
import { messageFor, readJob, readState, STALE_AFTER } from '../booklist/jobs';
import { ownedBook } from './books';

export const booklists = new Hono<AppEnv>();
booklists.use('/:id/booklist', requireAuth);
booklists.use('/:id/booklist', bodyLimit({ maxSize: 1024, onError: () => { throw new HttpError(413, 'too_large', 'Request too large'); } }));
booklists.on(['GET', 'POST'], '/:id/booklist', async c => {
  const book = await ownedBook(c, c.req.param('id')), user = c.get('user').id;
  if (c.req.method === 'POST' && c.env.BOOKLIST_ENABLED !== 'true') throw new HttpError(403, 'booklist_disabled', 'Book list extraction is currently disabled.');
  const input = c.req.method === 'POST' ? await parseBody(c, z.object({ retry: z.boolean().default(false) }).strict()) : { retry: false };
  const previous = await readJob(c.env, book.id), state = await readState(c.env, previous);
  if (c.req.method === 'GET' || state.status === 'ready' || state.status === 'running' || state.status !== 'missing' && !input.retry) return c.json(state);
  if (!c.env.DEEPSEEK_API_KEY || !c.env.INDEX_QUEUE) throw new HttpError(503, 'booklist_unavailable', 'AI service unavailable');
  await enforceRateLimit(c.env.DB, `booklist:minute:${user}`, 3, 60);
  await enforceRateLimit(c.env.DB, `booklist:day:${user}`, 20, 86400);
  const attempt = newId(), started = Date.now();
  const claim = previous
    ? await c.env.DB.prepare("UPDATE booklists SET status = 'running', attempt_id = ?, updated_at = ?, part_started_at = NULL, error_code = NULL WHERE book_id = ? AND attempt_id = ? AND (status = 'failed' OR (status = 'running' AND updated_at < ?))")
      .bind(attempt, started, book.id, previous.attempt_id, started - STALE_AFTER).run()
    : await c.env.DB.prepare("INSERT OR IGNORE INTO booklists (book_id, user_id, operation_id, attempt_id, status, updated_at) VALUES (?, ?, ?, ?, 'running', ?)")
      .bind(book.id, user, newId(), attempt, started).run();
  const job = await readJob(c.env, book.id);
  if (claim.meta.changes === 1 && job) {
    try { await c.env.INDEX_QUEUE.send(messageFor(job)); }
    catch {
      await c.env.DB.prepare("UPDATE booklists SET status = 'failed', error_code = 'booklist_queue' WHERE book_id = ? AND attempt_id = ? AND part_started_at IS NULL")
        .bind(book.id, attempt).run();
    }
  }
  return c.json(await readState(c.env, await readJob(c.env, book.id)));
});
