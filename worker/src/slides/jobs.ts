import type { SlidesResult, SlidesState } from '../../../shared/slides';
import { HttpError } from '../lib/util';
import { createCostMeter } from '../lib/costMeter';
import { slidesSource } from './source';
import { generateSlideContent, parseSlides, parseSummary } from './generate';
export const STALE_AFTER = 10 * 60_000;
export interface SlidesMessage { type: 'slides'; bookId: string; userId: string; target: string; operationId: string; attemptId: string; part: number }
export interface SlidesJob {
  book_id: string; user_id: string; target: string; operation_id: string; attempt_id: string;
  status: 'running' | 'ready' | 'failed'; total_parts: number; completed_parts: number;
  updated_at: number; part_started_at: number | null; error_code: string | null;
}
export const prefix = (user: string, book: string) => `users/${user}/books/${book}/slides/`;
export const key = (job: SlidesJob, name: string) => `${prefix(job.user_id, job.book_id)}${job.operation_id}/${name}.json`;
export const readJob = (env: Env, book: string, user: string, target: string) => env.DB.prepare('SELECT * FROM chapter_slides WHERE book_id = ? AND user_id = ? AND target = ?').bind(book, user, target).first<SlidesJob>();
export const messageFor = (job: SlidesJob): SlidesMessage => ({ type: 'slides', bookId: job.book_id, userId: job.user_id, target: job.target, operationId: job.operation_id, attemptId: job.attempt_id, part: job.total_parts ? job.completed_parts : -1 });
export async function readState(env: Env, job: SlidesJob | null): Promise<SlidesState> {
  if (!job) return { status: 'missing' };
  const saved = await env.BOOKS.get(key(job, 'result'));
  if (saved) return { status: 'ready', result: await saved.json<SlidesResult>(), completed: job.total_parts, total: job.total_parts };
  return { status: job.status === 'running' && Date.now() - job.updated_at > STALE_AFTER ? 'interrupted' : job.status === 'ready' ? 'failed' : job.status, completed: job.completed_parts, total: job.total_parts, ...(job.error_code ? { errorCode: job.error_code } : {}) };
}
export async function deleteSlides(bucket: R2Bucket, user: string, book: string) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: prefix(user, book), cursor });
    if (page.objects.length) await bucket.delete(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
const activeBook = (env: Env, job: SlidesJob) => env.DB.prepare("SELECT file_key FROM books WHERE id = ? AND user_id = ? AND status != 'deleting'").bind(job.book_id, job.user_id).first<{ file_key: string }>();
async function save(env: Env, job: SlidesJob, name: string, value: unknown) {
  await env.BOOKS.put(key(job, name), JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
  if (!await activeBook(env, job)) { await deleteSlides(env.BOOKS, job.user_id, job.book_id); throw new HttpError(404, 'not_found', 'Book not found'); }
}
async function advance(env: Env, job: SlidesJob) {
  const current = await readJob(env, job.book_id, job.user_id, job.target);
  if (current?.status === 'running' && current.attempt_id === job.attempt_id) await env.INDEX_QUEUE.send(messageFor(current));
}
async function process(env: Env, job: SlidesJob, message: SlidesMessage) {
  const book = await activeBook(env, job);
  if (!book) return;
  if (!job.total_parts) {
    const file = await env.BOOKS.get(book.file_key);
    if (!file) throw new HttpError(404, 'slides_source_missing', 'Book source missing');
    if (file.size > 50 * 1024 * 1024) throw new HttpError(413, 'slides_too_large', 'Book file too large');
    const source = slidesSource(new Uint8Array(await file.arrayBuffer()), job.target);
    await save(env, job, 'source', source);
    // Short chapters need one call; long ones use summaries followed by a synthesis call.
    await env.DB.prepare("UPDATE chapter_slides SET total_parts = ?, updated_at = ? WHERE operation_id = ? AND attempt_id = ? AND total_parts = 0 AND status = 'running'")
      .bind(source.parts.length === 1 ? 1 : source.parts.length + 1, Date.now(), job.operation_id, job.attempt_id).run();
    await advance(env, job); return;
  }
  if (message.part < job.completed_parts) { await advance(env, job); return; }
  if (message.part !== job.completed_parts) return;
  const part = job.completed_parts, summary = part < job.total_parts - 1;
  const storedSource = await env.BOOKS.get(key(job, 'source'));
  if (!storedSource) throw new HttpError(500, 'slides_source_missing', 'Chapter source missing');
  const source = await storedSource.json<{ title: string; parts: string[] }>();
  let content = await env.BOOKS.get(key(job, `raw/${part}`)).then(o => o?.json<string>());
  if (!content) {
    const claim = await env.DB.prepare("UPDATE chapter_slides SET part_started_at = ?, updated_at = ? WHERE operation_id = ? AND attempt_id = ? AND status = 'running' AND completed_parts = ? AND part_started_at IS NULL")
      .bind(Date.now(), Date.now(), job.operation_id, job.attempt_id, part).run();
    if (claim.meta.changes !== 1) return;
    let text = source.parts[part];
    if (!summary && source.parts.length > 1) {
      const summaries: string[] = [];
      for (let i = 0; i < source.parts.length; i++) {
        const raw = await env.BOOKS.get(key(job, `raw/${i}`));
        if (!raw) throw new HttpError(500, 'slides_source_missing', 'Chapter summary missing');
        summaries.push(`PART ${i + 1}/${source.parts.length}\n${parseSummary(await raw.json<string>())}`);
      }
      text = summaries.join('\n\n');
    }
    content = await generateSlideContent(env, { title: source.title, text }, summary,
      { operationId: job.operation_id, userId: job.user_id, bookId: job.book_id }, value => save(env, job, `raw/${part}`, value));
  }
  if (summary) {
    parseSummary(content);
    await env.DB.prepare("UPDATE chapter_slides SET completed_parts = completed_parts + 1, updated_at = ?, part_started_at = NULL WHERE operation_id = ? AND attempt_id = ? AND status = 'running' AND completed_parts = ?")
      .bind(Date.now(), job.operation_id, job.attempt_id, part).run();
    await advance(env, job);
  } else {
    const result: SlidesResult = { title: source.title, slides: parseSlides(content), operationId: job.operation_id, generatedAt: Date.now() };
    await save(env, job, 'result', result);
    await env.DB.prepare("UPDATE chapter_slides SET status = 'ready', completed_parts = total_parts, updated_at = ?, part_started_at = NULL WHERE operation_id = ? AND attempt_id = ? AND status = 'running'")
      .bind(Date.now(), job.operation_id, job.attempt_id).run();
  }
}
export async function handleSlidesMessage(input: Env, message: SlidesMessage) {
  const meter = createCostMeter(input), env = meter.env;
  const job = await readJob(env, message.bookId, message.userId, message.target);
  if (!job || job.status !== 'running' || job.operation_id !== message.operationId || job.attempt_id !== message.attemptId) return;
  const started = Date.now(); let status = 'succeeded';
  try { await process(env, job, message); }
  catch (error) {
    status = 'failed';
    if (!(error instanceof HttpError)) throw error; // Retry storage/queue delivery only; paid calls retain their lock.
    await env.DB.prepare("UPDATE chapter_slides SET status = 'failed', error_code = ?, updated_at = ? WHERE operation_id = ? AND attempt_id = ? AND status = 'running'")
      .bind(error.code, Date.now(), job.operation_id, job.attempt_id).run();
  } finally { await meter.finish(job.user_id, job.book_id, '章节幻灯片后台任务', started, status); }
}
