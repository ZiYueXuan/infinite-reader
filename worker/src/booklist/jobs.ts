import type { BookListResult, BookListState, ReferencedBook } from '../../../shared/booklist';
import { createCostMeter } from '../lib/costMeter';
import { HttpError } from '../lib/util';
import { parseEpub } from '../pipeline/epub';
import { extractReferences, mergeReferences, splitBookText, type ReferencePart } from './extract';

export const STALE_AFTER = 10 * 60_000;
export interface BookListMessage { type: 'booklist'; bookId: string; operationId: string; attemptId: string; part: number }
export interface Job {
  book_id: string; user_id: string; operation_id: string; attempt_id: string;
  status: 'running' | 'ready' | 'failed'; total_parts: number; completed_parts: number;
  updated_at: number; part_started_at: number | null; error_code: string | null;
}
export const prefix = (user: string, book: string) => `users/${user}/books/${book}/booklist/`;
const key = (job: Job, suffix: string) => `${prefix(job.user_id, job.book_id)}${job.operation_id}/${suffix}.json`;
export const readJob = (env: Env, book: string) => env.DB.prepare('SELECT * FROM booklists WHERE book_id = ?').bind(book).first<Job>();
export const messageFor = (job: Job): BookListMessage => ({ type: 'booklist', bookId: job.book_id, operationId: job.operation_id, attemptId: job.attempt_id, part: job.total_parts ? job.completed_parts : -1 });
export async function readState(env: Env, job: Job | null): Promise<BookListState> {
  if (!job) return { status: 'missing' };
  // Recover the final paid result even if the last D1 write failed.
  const result = await env.BOOKS.get(key(job, 'result'));
  if (result) return { status: 'ready', completed: job.total_parts, total: job.total_parts, result: await result.json<BookListResult>() };
  return { status: job.status === 'running' && Date.now() - job.updated_at > STALE_AFTER ? 'interrupted' : job.status === 'ready' ? 'failed' : job.status,
    completed: job.completed_parts, total: job.total_parts, ...(job.error_code ? { errorCode: job.error_code } : {}) };
}
export async function deleteBookList(bucket: R2Bucket, user: string, book: string) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: prefix(user, book), cursor });
    if (page.objects.length) await bucket.delete(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function activeBook(env: Env, job: Job) {
  return env.DB.prepare("SELECT file_key FROM books WHERE id = ? AND user_id = ? AND status != 'deleting'").bind(job.book_id, job.user_id).first<{ file_key: string }>();
}
async function save(env: Env, job: Job, suffix: string, value: unknown) {
  await env.BOOKS.put(key(job, suffix), JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
  // Deletion can race an in-flight provider call. Do not leave re-created private objects behind.
  if (!await activeBook(env, job)) { await deleteBookList(env.BOOKS, job.user_id, job.book_id); throw new HttpError(404, 'not_found', 'Book not found'); }
}
async function advance(env: Env, job: Job) {
  const current = await readJob(env, job.book_id);
  if (!current || current.status !== 'running' || current.attempt_id !== job.attempt_id) return;
  if (current.completed_parts < current.total_parts) {
    await env.INDEX_QUEUE.send(messageFor(current));
    return;
  }
  const parts: ReferencedBook[][] = [];
  let excludedCandidates = 0;
  for (let i = 0; i < current.total_parts; i++) {
    const stored = await env.BOOKS.get(key(current, `results/${i}`));
    if (!stored) throw new Error('Missing completed book list part');
    const part = await stored.json<ReferencedBook[] | ReferencePart>();
    // Older successful chunks were stored as arrays; preserve their paid results on resume.
    parts.push(Array.isArray(part) ? part : part.books);
    if (!Array.isArray(part)) excludedCandidates += part.excludedCandidates;
  }
  const result: BookListResult = { books: mergeReferences(parts), excludedCandidates, operationId: job.operation_id, generatedAt: Date.now() };
  await save(env, job, 'result', result);
  await env.DB.prepare("UPDATE booklists SET status = 'ready', updated_at = ?, part_started_at = NULL WHERE book_id = ? AND attempt_id = ? AND status = 'running'")
    .bind(Date.now(), job.book_id, job.attempt_id).run();
}

async function processPart(env: Env, job: Job, message: BookListMessage) {
  const book = await activeBook(env, job);
  if (!book) return;
  if (!job.total_parts) {
    // Preparation is local, safe to repeat; no model is called until a durable manifest exists.
    const file = await env.BOOKS.get(book.file_key);
    if (!file) throw new HttpError(404, 'booklist_source_missing', 'Book source missing');
    if (file.size > 50 * 1024 * 1024) throw new HttpError(413, 'booklist_too_large', 'Book file too large');
    const parsed = parseEpub(new Uint8Array(await file.arrayBuffer()), { skipCover: true, includeAllText: true });
    const parts = splitBookText(parsed.chapters.map(ch => ch.text).join('\n\n'));
    for (let i = 0; i < parts.length; i++) await save(env, job, `sources/${i}`, parts[i]);
    await env.DB.prepare("UPDATE booklists SET total_parts = ?, updated_at = ? WHERE book_id = ? AND attempt_id = ? AND total_parts = 0 AND status = 'running'")
      .bind(parts.length, Date.now(), job.book_id, job.attempt_id).run();
    await advance(env, job);
    return;
  }
  if (message.part < job.completed_parts || message.part === -1) { await advance(env, job); return; }
  if (message.part !== job.completed_parts) return;
  if (job.completed_parts === job.total_parts) { await advance(env, job); return; }
  const part = job.completed_parts;
  const saved = await env.BOOKS.get(key(job, `results/${part}`));
  if (!saved) {
    // At-most-one paid call per part/attempt, including concurrent queue deliveries.
    const claim = await env.DB.prepare("UPDATE booklists SET part_started_at = ?, updated_at = ? WHERE book_id = ? AND attempt_id = ? AND status = 'running' AND completed_parts = ? AND part_started_at IS NULL")
      .bind(Date.now(), Date.now(), job.book_id, job.attempt_id, part).run();
    if (claim.meta.changes !== 1) return; // Lost workers require an explicit user retry after the lease expires.
    const source = await env.BOOKS.get(key(job, `sources/${part}`));
    if (!source) throw new HttpError(500, 'booklist_source_missing', 'Book list source missing');
    await extractReferences(env, await source.json<string>(), { operationId: job.operation_id, userId: job.user_id, bookId: job.book_id },
      books => save(env, job, `results/${part}`, books));
  }
  await env.DB.prepare("UPDATE booklists SET completed_parts = completed_parts + 1, updated_at = ?, part_started_at = NULL WHERE book_id = ? AND attempt_id = ? AND status = 'running' AND completed_parts = ?")
    .bind(Date.now(), job.book_id, job.attempt_id, part).run();
  await advance(env, job);
}

export async function handleBookListMessage(input: Env, message: BookListMessage) {
  // Acknowledge old queue deliveries without starting another paid chunk.
  if (input.BOOKLIST_ENABLED !== 'true') {
    await input.DB.prepare("UPDATE booklists SET status = 'failed', error_code = 'booklist_disabled', updated_at = ? WHERE book_id = ? AND operation_id = ? AND attempt_id = ? AND status = 'running'")
      .bind(Date.now(), message.bookId, message.operationId, message.attemptId).run();
    return;
  }
  const meter = createCostMeter(input), env = meter.env, started = Date.now();
  const job = await readJob(env, message.bookId);
  if (!job || job.status !== 'running' || job.operation_id !== message.operationId || job.attempt_id !== message.attemptId) return;
  let status = 'succeeded';
  try { await processPart(env, job, message); }
  catch (error) {
    status = 'failed';
    if (!(error instanceof HttpError)) throw error; // Storage/queue errors can retry, never a claimed paid request.
    await env.DB.prepare("UPDATE booklists SET status = 'failed', error_code = ?, updated_at = ? WHERE book_id = ? AND attempt_id = ? AND status = 'running'")
      .bind(error.code, Date.now(), job.book_id, job.attempt_id).run();
  } finally { await meter.finish(job.user_id, job.book_id, '书单提取后台任务', started, status); }
}
