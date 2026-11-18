import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { requireAuth, type AppEnv } from '../auth';
import { enforceRateLimit, HttpError, newId, parseBody } from '../lib/util';
import { key, messageFor, readJob, readState } from '../slides/jobs';
import { parseSlides, parseSummary } from '../slides/generate';
import { ownedBook } from './books';
export const slides = new Hono<AppEnv>();
slides.use('*', requireAuth);
slides.use('*', bodyLimit({ maxSize: 4096, onError: () => { throw new HttpError(413, 'too_large', 'Request too large'); } }));
const targetSchema = z.string().min(1).max(1500);
slides.get('/:id/slides-index', async c => {
  const book = await ownedBook(c, c.req.param('id'));
  const rows = await c.env.DB.prepare("SELECT target FROM chapter_slides WHERE book_id = ? AND user_id = ? AND status = 'ready'").bind(book.id, c.get('user').id).all<{ target: string }>();
  return c.json({ readyTargets: rows.results.map(r => r.target) });
});
slides.on(['GET', 'POST'], '/:id/slides', async c => {
  const book = await ownedBook(c, c.req.param('id')), user = c.get('user').id;
  const input = c.req.method === 'POST'
    ? await parseBody(c, z.object({ target: targetSchema, retry: z.boolean().default(false) }).strict())
    : { target: targetSchema.safeParse(c.req.query('target')).data, retry: false };
  if (!input.target) throw new HttpError(400, 'invalid_target', 'Invalid navigation target');
  const target = input.target;
  const previous = await readJob(c.env, book.id, user, target), state = await readState(c.env, previous);
  if (c.req.method === 'GET' || state.status === 'ready' || state.status === 'running' || state.status === 'interrupted' || state.status === 'failed' && !input.retry) return c.json(state);
  if (!c.env.DEEPSEEK_API_KEY || !c.env.INDEX_QUEUE) throw new HttpError(503, 'slides_unavailable', 'AI service unavailable');
  await enforceRateLimit(c.env.DB, `slides:minute:${user}`, 3, 60);
  await enforceRateLimit(c.env.DB, `slides:day:${user}`, 20, 86400);
  const attempt = newId(), started = Date.now();
  const claim = previous
    ? await c.env.DB.prepare("UPDATE chapter_slides SET status = 'running', attempt_id = ?, updated_at = ?, part_started_at = NULL, error_code = NULL WHERE operation_id = ? AND attempt_id = ? AND status = 'failed'").bind(attempt, started, previous.operation_id, previous.attempt_id).run()
    : await c.env.DB.prepare("INSERT OR IGNORE INTO chapter_slides (book_id, user_id, target, operation_id, attempt_id, status, updated_at) VALUES (?, ?, ?, ?, ?, 'running', ?)").bind(book.id, user, target, newId(), attempt, started).run();
  const job = await readJob(c.env, book.id, user, target);
  if (claim.meta.changes === 1 && job) {
    // Failed schema validation can be retried explicitly; valid paid checkpoints are always reused.
    if (previous?.status === 'failed') {
      const raw = await c.env.BOOKS.get(key(previous, `raw/${previous.completed_parts}`));
      if (raw) {
        try { const content = await raw.json<string>(); if (previous.completed_parts < previous.total_parts - 1) parseSummary(content); else parseSlides(content); }
        catch { await c.env.BOOKS.delete(key(previous, `raw/${previous.completed_parts}`)); }
      }
    }
    try { await c.env.INDEX_QUEUE.send(messageFor(job)); }
    catch { await c.env.DB.prepare("UPDATE chapter_slides SET status = 'failed', error_code = 'slides_queue' WHERE operation_id = ? AND attempt_id = ? AND part_started_at IS NULL").bind(job.operation_id, attempt).run(); }
  }
  return c.json(await readState(c.env, await readJob(c.env, book.id, user, target)));
});
