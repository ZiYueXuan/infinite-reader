import { env } from 'cloudflare:workers';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEpub, Client, makeEnv, mockFetch, resetDb } from './helpers';
import { handleBookListMessage, readJob, messageFor, prefix, STALE_AFTER, type BookListMessage } from '../src/booklist/jobs';
import { mergeReferences, parseReferences, parseReferencePart, splitBookText } from '../src/booklist/extract';
import type { BookListState } from '../../shared/booklist';
import type { CostSnapshot } from '../../shared/costs';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
const first = { title: 'Alpha', author: 'Ada', quote: 'Ada wrote Alpha.' };
const last = { title: '最后一本', author: null, quote: '《最后一本》' };
const completion = (books: unknown[], patch: object = {}) => ({ model: 'DeepSeek-V4.1-Flash-1017', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ books }) } }], usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 300, prompt_cache_miss_tokens: 700 }, ...patch });
async function setup(long = false, nonSpine = false) {
  const te = makeEnv({ BOOKLIST_ENABLED: 'true' }), client = new Client(te), { user } = await client.login('cost-admin@example.test');
  const files = unzipSync(buildEpub());
  if (nonSpine) files['OEBPS/content.opf'] = strToU8(strFromU8(files['OEBPS/content.opf']).replace('<itemref idref="c2"/>', ''));
  files['OEBPS/text/ch1.xhtml'] = strToU8(`<html><body><p>Ada wrote Alpha.</p><p>${'Plain text. '.repeat(long ? 2400 : 10)}</p></body></html>`);
  // A tiny final spine entry must not be dropped by the indexing parser's usual 20-character filter.
  files['OEBPS/text/ch2.xhtml'] = strToU8('<html><body><p>《最后一本》</p></body></html>');
  const form = new FormData(); form.set('file', new File([zipSync(files)], 'references.epub'));
  const { book } = await (await client.fetch('/api/books', { method: 'POST', body: form })).json() as any;
  const messages: BookListMessage[] = [];
  Object.assign(te.env, { INDEX_QUEUE: { send: vi.fn(async (message: BookListMessage) => { messages.push(message); }) } });
  const endpoint = `/api/books/${book.id}/booklist`;
  const post = (retry = false) => client.fetch(endpoint, { method: 'POST', json: { retry } });
  const get = async () => (await (await client.fetch(endpoint)).json()) as BookListState;
  const step = async () => { const m = messages.shift()!; expect(m).toBeTruthy(); await handleBookListMessage(te.env, m); return m; };
  const drain = async () => { for (let i = 0; messages.length && i < 20; i++) await step(); expect(messages).toHaveLength(0); };
  return { te, client, user, book, endpoint, messages, post, get, step, drain };
}
function model() {
  return mockFetch({ 'https://llm.test/chat/completions': async req => {
    const request = await req.json() as any;
    expect(request.model).toBe('deepseek-flash');
    const { text } = JSON.parse(request.messages[1].content);
    return Response.json(completion([...(text.includes(first.quote) ? [first] : []), ...(text.includes(last.quote) ? [last] : [])]));
  } });
}

describe('full-book reference extraction', () => {
  it('blocks both start and retry when disabled, including stale clients, without queueing or AI calls', async () => {
    const s = await setup(), mocked = model();
    Object.assign(s.te.env, { BOOKLIST_ENABLED: 'false' });
    for (const retry of [false, true]) {
      const response = await s.post(retry);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'booklist_disabled' } });
    }
    expect(s.messages).toHaveLength(0);
    expect(mocked.calls).toHaveLength(0);
    expect(await readJob(s.te.env, s.book.id)).toBeNull();
  });
  it('stops queued work when disabled and retains completed chunks and usage history', async () => {
    const s = await setup(true), mocked = model();
    await s.post(); await s.step(); await s.step();
    const before = await env.BOOKS.list({ prefix: prefix(s.user.id, s.book.id) });
    expect(mocked.calls).toHaveLength(1);
    Object.assign(s.te.env, { BOOKLIST_ENABLED: 'false' });
    await s.drain();
    expect(mocked.calls).toHaveLength(1);
    expect(await s.get()).toMatchObject({ status: 'failed', completed: 1, errorCode: 'booklist_disabled' });
    expect((await env.BOOKS.list({ prefix: prefix(s.user.id, s.book.id) })).objects).toEqual(before.objects);
    expect((await env.DB.prepare("SELECT id FROM ai_usage WHERE feature = 'booklist'").all()).results).toHaveLength(1);
  });
  it('keeps finished saved lists readable after disabling extraction', async () => {
    const s = await setup(), mocked = model();
    await s.post(); await s.drain();
    const result = await s.get();
    Object.assign(s.te.env, { BOOKLIST_ENABLED: 'false' });
    expect(await s.get()).toEqual(result);
    expect((await s.post(true)).status).toBe(403);
    expect(mocked.calls).toHaveLength(1);
  });
  it('preserves the full text and overlapping mentions, deduplicates titles and refuses invented evidence', () => {
    const text = 'intro '.repeat(5000) + '😀《Boundary book》😀' + ' end'.repeat(5000);
    const chunks = splitBookText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some(c => c.includes('《Boundary book》'))).toBe(true);
    const rebuilt = chunks[0] + chunks.slice(1).map(c => c.slice(600)).join('');
    expect(rebuilt).toBe(text);
    expect(() => splitBookText('x'.repeat(6_000_001))).toThrow();
    expect(mergeReferences([[first], [{ ...first, title: '《ALPHA》' }, last]])).toEqual([first, last]);
    expect(parseReferences(JSON.stringify({ books: [first] }), first.quote)).toEqual([first]);
    expect(() => parseReferences(JSON.stringify({ books: [{ ...first, title: 'Invented book' }] }), first.quote)).toThrow();
    expect(() => parseReferences(JSON.stringify({ books: [{ ...first, quote: 'Invented quotation' }] }), first.quote)).toThrow();
    expect(parseReferences(JSON.stringify({ books: [{ ...first, author: 'Unknown writer' }] }), first.quote)[0].author).toBe(null);
  });
  it('matches typographic variations but returns a verbatim source excerpt', () => {
    const source = 'He wrote “Reader’s Guide”—《Ａｌｐｈａ》.\n阅读《最后一本》。';
    const quote = 'He wrote "Reader\'s Guide"-《Alpha》.';
    expect(parseReferencePart(JSON.stringify({ books: [{ title: 'Alpha', quote }] }), source)).toEqual({
      books: [{ title: 'Alpha', author: null, quote: source.split('\n')[0] }], excludedCandidates: 0,
    });
    expect(() => parseReferences(JSON.stringify({ books: [{ title: 'Art', quote: 'Earth' }] }), 'Earth')).toThrow();
  });
  it('keeps verified candidates, reports exclusions and rejects entirely unverified results', () => {
    const candidates = [first, { ...first, title: 'Invented' }, { ...first, quote: 'Ada rewrote Alpha.' }, { title: null }];
    expect(parseReferencePart(JSON.stringify({ books: candidates }), first.quote)).toEqual({ books: [first], excludedCandidates: 3 });
    expect(() => parseReferencePart(JSON.stringify({ books: candidates.slice(1) }), first.quote)).toThrow();
    expect(() => parseReferencePart('{"books":"invalid"}', first.quote)).toThrow();
    expect(parseReferencePart('{"books":[]}', first.quote)).toEqual({ books: [], excludedCandidates: 0 });
  });
  it('saves mixed valid results with a visible exclusion count and meters the one paid call', async () => {
    const s = await setup();
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(completion([first, { ...first, title: 'Invented' }])) });
    await s.post(); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'ready', result: { books: [first], excludedCandidates: 1 } });
    await s.post(true); await s.get();
    expect(mocked.calls).toHaveLength(1);
    expect(await env.DB.prepare("SELECT status, output_tokens FROM ai_usage WHERE feature = 'booklist'").first()).toMatchObject({ status: 'succeeded', output_tokens: 200 });
  });
  it('resumes legacy saved chunks without paying to regenerate them', async () => {
    const s = await setup(true), mocked = model();
    await s.post(); await s.step(); await s.step();
    const job = (await readJob(s.te.env, s.book.id))!;
    await env.BOOKS.put(`${prefix(s.user.id, s.book.id)}${job.operation_id}/results/0.json`, JSON.stringify([first]));
    await env.DB.prepare("UPDATE booklists SET status = 'failed' WHERE book_id = ?").bind(s.book.id).run();
    s.messages.length = 0;
    await s.post(true); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'ready', result: { books: [first, last], excludedCandidates: 0 } });
    expect(mocked.calls).toHaveLength(2);
  });
  it('starts empty, reads without AI, processes ALL chunks, persists and records per-call usage and priced costs', async () => {
    const s = await setup(true), mocked = model();
    expect(await s.get()).toEqual({ status: 'missing' });
    expect(mocked.calls).toHaveLength(0);
    expect(await (await s.post()).json()).toMatchObject({ status: 'running', completed: 0 });
    await s.drain();
    const result = await s.get();
    expect(result).toMatchObject({ status: 'ready', total: 2, completed: 2, result: { books: [first, last] } });
    expect(mocked.calls).toHaveLength(2);
    expect(await (await s.post(true)).json()).toEqual(result);
    const another = new Client(s.te); another.cookie = s.client.cookie;
    expect(await (await another.fetch(s.endpoint)).json()).toEqual(result);
    expect(mocked.calls).toHaveLength(2);
    const usage = await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'booklist'").all<any>();
    expect(usage.results).toHaveLength(2);
    for (const row of usage.results) expect(row).toMatchObject({ user_id: s.user.id, book_id: s.book.id, operation_id: result.result!.operationId, status: 'succeeded', usage_status: 'reported', input_tokens: 1000, output_tokens: 200, cached_input_tokens: 300, uncached_input_tokens: 700 });
    const costs = await (await s.client.fetch(`/api/costs?book=${s.book.id}&since=0`)).json() as CostSnapshot;
    const items = costs.items.filter(i => i.category === 'booklist');
    expect(items).toHaveLength(2);
    for (const item of items) { expect(item.label).toBe('提取书单'); expect(item.usd).toBeGreaterThan(0); expect(item.tokens).toEqual({ input: 1000, output: 200, cached: 300 }); }
    expect(costs.items.some(i => i.label === '书单提取后台任务')).toBe(true);
    expect(costs.items.some(i => i.label === '书单请求')).toBe(true);
  });
  it('includes short reference/endnote files outside the reading spine', async () => {
    const s = await setup(false, true), mocked = model();
    await s.post(); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'ready', result: { books: [first, last] } });
    expect(mocked.calls).toHaveLength(1);
  });
  it('excludes other accounts and unauthenticated callers, including POST', async () => {
    const s = await setup(), outsider = new Client(s.te), mocked = model();
    expect((await outsider.fetch(s.endpoint)).status).toBe(401);
    await outsider.login('other@example.com');
    for (const method of ['GET', 'POST']) expect((await outsider.fetch(s.endpoint, { method, ...(method === 'POST' ? { json: {} } : {}) })).status).toBe(404);
    expect(mocked.calls).toHaveLength(0);
  });
  it('scopes the small request body limit to book lists without breaking long highlights', async () => {
    const s = await setup();
    expect((await s.client.fetch(s.endpoint, { method: 'POST', json: { padding: 'x'.repeat(2000) } })).status).toBe(413);
    const response = await s.client.fetch(`/api/books/${s.book.id}/annotations`, { method: 'POST', json: { kind: 'highlight', anchor: { chapter: 0, start: 0, end: 2000 }, text: 'x'.repeat(2000) } });
    expect(response.status).toBe(201);
  });
  it('coalesces concurrent requests and duplicate queue deliveries before a paid call', async () => {
    const s = await setup(), mocked = model();
    await Promise.all([s.post(), s.post()]);
    expect(s.messages).toHaveLength(1);
    await s.step(); // prepare
    const message = s.messages.shift()!;
    await Promise.all([handleBookListMessage(s.te.env, message), handleBookListMessage(s.te.env, message)]);
    await s.drain();
    expect((await s.get()).status).toBe('ready');
    expect(mocked.calls).toHaveLength(1);
    await handleBookListMessage(s.te.env, message);
    expect(mocked.calls).toHaveLength(1);
  });
  it('retains completed parts and meters invalid/length failures, with explicit retry only', async () => {
    const s = await setup(true);
    let calls = 0;
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(++calls === 2
      ? completion([], { choices: [{ finish_reason: 'length', message: { content: '{"books":[' } }] })
      : completion(calls === 1 ? [first] : [last])) });
    await s.post(); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'failed', completed: 1, total: 2, errorCode: 'booklist_truncated' });
    await s.post(); await s.get(); expect(mocked.calls).toHaveLength(2); expect(s.messages).toHaveLength(0);
    await s.post(true); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'ready', result: { books: [first, last] } });
    expect(mocked.calls).toHaveLength(3);
    const rows = await env.DB.prepare("SELECT status, error_code, input_tokens, output_tokens FROM ai_usage WHERE feature = 'booklist'").all<any>();
    expect(rows.results).toHaveLength(3);
    expect(rows.results.find(r => r.status === 'failed')).toMatchObject({ error_code: 'booklist_truncated', input_tokens: 1000, output_tokens: 200 });
  });
  it('does not mislabel storage failures as invalid model evidence or repeat a saved paid result', async () => {
    const s = await setup(), mocked = model();
    await s.post(); await s.step();
    const message = s.messages.shift()!, bucket = s.te.env.BOOKS;
    Object.assign(s.te.env, { BOOKS: new Proxy(bucket, { get(target, prop) {
      if (prop === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
        const result = await (target.put as any)(...args);
        if (String(args[0]).endsWith('/results/0.json')) throw new Error('Storage acknowledgement lost');
        return result;
      };
      const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
    } }) });
    await expect(handleBookListMessage(s.te.env, message)).rejects.toThrow('Storage acknowledgement lost');
    expect(await env.DB.prepare("SELECT status, error_code, output_tokens FROM ai_usage WHERE feature = 'booklist'").first()).toMatchObject({ status: 'failed', error_code: 'booklist_storage', output_tokens: 200 });
    Object.assign(s.te.env, { BOOKS: bucket });
    await handleBookListMessage(s.te.env, message);
    expect(await s.get()).toMatchObject({ status: 'ready', result: { books: [first, last] } });
    expect(mocked.calls).toHaveLength(1);
  });
  it('recovers a completed R2 part after D1 failure without another paid call', async () => {
    const s = await setup(), mocked = model();
    await s.post(); await s.step();
    const message = s.messages.shift()!;
    const db = s.te.env.DB;
    Object.assign(s.te.env, { DB: new Proxy(db, { get(target, prop) {
      if (prop === 'prepare') return (sql: string) => {
        if (sql.includes('SET completed_parts = completed_parts + 1')) throw new Error('D1 unavailable after paid completion');
        return target.prepare(sql);
      };
      const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
    } }) });
    await expect(handleBookListMessage(s.te.env, message)).rejects.toThrow('D1 unavailable');
    Object.assign(s.te.env, { DB: db });
    await handleBookListMessage(s.te.env, message);
    expect(await s.get()).toMatchObject({ status: 'ready', result: { books: [first, last] } });
    expect(mocked.calls).toHaveLength(1);
  });
  it('never auto-repeats an interrupted paid call; expired attempts can be explicitly resumed and fence old deliveries', async () => {
    const s = await setup(), mocked = model();
    await s.post(); await s.step();
    const message = s.messages.shift()!;
    await env.DB.prepare('UPDATE booklists SET part_started_at = ?').bind(Date.now()).run();
    await handleBookListMessage(s.te.env, message);
    expect(mocked.calls).toHaveLength(0);
    await env.DB.prepare('UPDATE booklists SET updated_at = ?').bind(Date.now() - STALE_AFTER - 1).run();
    expect((await s.get()).status).toBe('interrupted');
    await s.post(); expect(s.messages).toHaveLength(0);
    await s.post(true);
    await handleBookListMessage(s.te.env, message); expect(mocked.calls).toHaveLength(0);
    await s.drain(); expect((await s.get()).status).toBe('ready'); expect(mocked.calls).toHaveLength(1);
  });
  it('saves an empty extraction and rejects invalid model evidence while retaining billed tokens', async () => {
    const s = await setup();
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(completion([{ ...first, title: 'Hallucination' }])) });
    await s.post(); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'failed', errorCode: 'booklist_evidence_empty' });
    expect(await env.DB.prepare("SELECT status, output_tokens FROM ai_usage WHERE feature = 'booklist'").first()).toMatchObject({ status: 'failed', output_tokens: 200 });
    mocked.restore();
    const empty = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(completion([])) });
    await s.post(true); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'ready', result: { books: [] } });
    await s.post(); expect(empty.calls).toHaveLength(1);
  });
  it('deletion removes saved source/results and prevents delayed jobs from recreating them', async () => {
    const s = await setup(), mocked = model();
    await s.post(); await s.drain();
    const job = (await readJob(s.te.env, s.book.id))!;
    expect((await env.BOOKS.list({ prefix: prefix(s.user.id, s.book.id) })).objects.length).toBeGreaterThan(0);
    expect((await s.client.fetch(`/api/books/${s.book.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await readJob(s.te.env, s.book.id)).toBeNull();
    await handleBookListMessage(s.te.env, messageFor(job));
    expect((await env.BOOKS.list({ prefix: prefix(s.user.id, s.book.id) })).objects).toHaveLength(0);
    expect(mocked.calls).toHaveLength(1);
  });
});
