import { env } from 'cloudflare:workers';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEpub, Client, makeEnv, mockFetch, resetDb } from './helpers';
import { mindmapSource } from '../src/mindmap/source';
import { validateTree } from '../src/mindmap/generate';
import { parseMindmapContent } from '../src/mindmap/output';
import { sha256Hex } from '../src/lib/util';
import type { MindmapState } from '../../shared/mindmap';
import type { CostSnapshot } from '../../shared/costs';

const target = 'OEBPS/text/ch1.xhtml';
const tree = { text: '知识体系', children: [{ text: '主要观点', children: [{ text: '论证与例子', children: [] }] }, { text: '结论', children: [] }] };
const completion = (patch: object = {}) => ({ model: 'deepseek-flash', id: 'request-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(tree) } }], usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 300, prompt_cache_miss_tokens: 700 }, ...patch });
function fixture(flat = false) {
  const files = unzipSync(buildEpub());
  files['OEBPS/nav.xhtml'] = strToU8(`<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/ch1.xhtml">第一章 原理</a>${flat ? '</li>' : '<ol>'}<li><a href="text/ch1.xhtml#s1">第一节</a></li><li><a href="text/ch1.xhtml#s2">第二节</a></li>${flat ? '' : '</ol></li>'}<li><a href="text/ch2.xhtml">第二章 应用</a></li></ol></nav></body></html>`);
  files[target] = strToU8('<html><head><title>ignore</title></head><body><h1>第一章 原理</h1><p>引言。</p><section id="s1"><h2>第一节</h2><p>' + 'ALPHA first section evidence. '.repeat(8) + '</p></section><section id="s2"><h2>第二节</h2><p>' + 'BETA second section evidence. '.repeat(8) + '</p></section></body></html>');
  return zipSync(files);
}
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const te = makeEnv(), client = new Client(te), { user } = await client.login('cost-admin@example.test');
  const form = new FormData(); form.set('file', new File([fixture()], 'mindmaps.epub'));
  const { book } = await (await client.fetch('/api/books', { method: 'POST', body: form })).json() as any;
  const endpoint = `/api/books/${book.id}/mindmap`;
  return { te, client, user, book, endpoint,
    post: (body = { target, retry: false }) => client.fetch(endpoint, { method: 'POST', json: body }),
    get: () => client.fetch(endpoint + '?target=' + encodeURIComponent(target)),
  };
}

describe('section boundaries', () => {
  it('includes all descendant sections for a chapter and stops each section at its sibling, including inferred flat hierarchies', () => {
    for (const flat of [false, true]) {
      const bytes = fixture(flat);
      const all = mindmapSource(bytes, target).text;
      expect(all).toContain('ALPHA'); expect(all).toContain('BETA'); expect(all).not.toContain('volcanoes');
      const first = mindmapSource(bytes, target + '#s1').text;
      expect(first).toContain('ALPHA'); expect(first).not.toContain('BETA');
      const last = mindmapSource(bytes, target + '#s2').text;
      expect(last).toContain('BETA'); expect(last).not.toContain('ALPHA'); expect(last).not.toContain('volcanoes');
    }
  });
  it('supports chapters spanning multiple spine files', () => {
    const files = unzipSync(fixture());
    files['OEBPS/nav.xhtml'] = strToU8('<html><body><nav><ol><li><a href="text/ch1.xhtml">Parent</a><ol><li><a href="text/ch2.xhtml">Child</a></li></ol></li></ol></nav></body></html>');
    expect(mindmapSource(zipSync(files), target).text).toContain('volcanoes');
  });
  it('rejects ambiguous missing anchors and oversized text before inference', () => {
    expect(() => mindmapSource(fixture(), target + '#missing')).toThrow();
    const files = unzipSync(fixture());
    files[target] = strToU8('<html><body>' + 'z'.repeat(100_001) + '</body></html>');
    expect(() => mindmapSource(zipSync(files), target)).toThrow('本章内容较长');
  });
  it('bounds model trees and keeps labels as inert text', () => {
    expect(validateTree(tree)).toEqual(tree);
    expect(() => validateTree({ text: 'x', children: [] })).toThrow();
    expect(() => validateTree({ text: 'x', children: Array(121).fill({ text: 'y', children: [] }) })).toThrow();
    expect(validateTree({ text: '<script>bad()</script>', children: tree.children }).text).toContain('<script>');
  });
});

describe('completed output normalization', () => {
  it('accepts missing/null leaf children, label aliases and fenced root wrappers without dropping content', () => {
    const input = { root: { title: '章节', children: [{ name: '观点', children: [{ label: '依据', children: null }, '例子'] }, { text: '结论' }] } };
    expect(parseMindmapContent('```json\n' + JSON.stringify(input) + '\n```')).toEqual({ text: '章节', children: [
      { text: '观点', children: [{ text: '依据', children: [] }, { text: '例子', children: [] }] }, { text: '结论', children: [] },
    ] });
  });
  it('separates compact prompt targets from defensive safety limits', () => {
    const children = Array.from({ length: 16 }, (_, i) => ({ text: '分支' + i, children: Array.from({ length: 10 }, (_, j) => ({ text: '论证' + j })) }));
    const result = validateTree({ text: '标题', children });
    expect(result.children).toHaveLength(16);
    expect(result.children.flatMap(c => c.children)).toHaveLength(160);
    expect(validateTree({ text: '标题', children: [{ text: '段落'.repeat(100) }] }).children[0]!.text.length).toBe(200);
    expect(() => validateTree({ text: '标题', children: Array(65).fill({ text: 'x' }) })).toThrow();
    expect(() => validateTree({ text: '标题', children: Array(16).fill({ text: 'x', children: Array(32).fill({ text: 'leaf' }) }) })).toThrow();
    expect(() => validateTree({ text: '标题', children: [{ text: 'x'.repeat(1001) }] })).toThrow();
  });
  it('rejects broken JSON, malformed nodes, missing branches and excessive depth rather than inventing or truncating', () => {
    expect(() => parseMindmapContent('{"text":"x","children":[')).toThrow();
    expect(() => validateTree({ text: 'x' })).toThrow();
    expect(() => validateTree({ text: 'x', children: [{ text: 3 }] })).toThrow();
    expect(() => validateTree({ text: 'x', children: { text: 'y' } })).toThrow();
    let nested: any = { text: 'leaf' };
    for (let i = 0; i < 14; i++) nested = { text: 'branch', children: [nested] };
    expect(() => validateTree(nested)).toThrow();
  });
});

describe('durable mind maps and metering', () => {
  it('lists saved targets without diagram text or inference, distinguishes pending and excludes failed/interrupted jobs', async () => {
    const { client, user, book } = await setup();
    const endpoint = `/api/books/${book.id}/mindmaps`;
    const mocked = mockFetch({});
    expect(await (await client.fetch(endpoint)).json()).toEqual({ readyTargets: [], pending: false });
    for (const [name, status, age, result] of [
      ['ready', 'ready', 0, JSON.stringify({ privateText: 'Never return diagram contents in this index' })],
      ['pending', 'running', 0, null], ['interrupted', 'running', 200_000, null], ['failed', 'failed', 0, null],
    ] as const) {
      await env.DB.prepare('INSERT INTO mindmaps VALUES (?, ?, ?, ?, ?, ?, ?)').bind(user.id, book.id, name, name, status, Date.now() - age, result).run();
    }
    expect(await (await client.fetch(endpoint)).json()).toEqual({ readyTargets: ['ready'], pending: true });
    await env.DB.prepare("UPDATE mindmaps SET started_at = 0 WHERE status = 'running'").run();
    expect(await (await client.fetch(endpoint)).json()).toEqual({ readyTargets: ['ready'], pending: false });
    expect(mocked.calls).toHaveLength(0);
    expect((await env.DB.prepare("SELECT id FROM ai_usage WHERE feature = 'mindmap'").all()).results).toHaveLength(0);
  });

  it('generates once, persists across clients, and exposes exact provider tokens and priced cost items', async () => {
    const { te, client, post, get, book } = await setup();
    const mocked = mockFetch({ 'https://llm.test/chat/completions': async req => {
      const body = await req.json() as any;
      expect(body.messages[1].content).toContain('BETA');
      expect(body.messages[1].content).not.toContain('volcanoes');
      return Response.json(completion());
    } });
    expect(await (await get()).json()).toEqual({ status: 'missing' });
    const first = await (await post()).json() as MindmapState;
    expect(first).toMatchObject({ status: 'ready', cached: false, result: { tree } });
    expect(await (await post()).json()).toMatchObject({ status: 'ready', cached: true, result: first.result });
    const second = new Client(te); second.cookie = client.cookie;
    expect(await (await second.fetch(`/api/books/${book.id}/mindmap?target=${encodeURIComponent(target)}`)).json()).toMatchObject({ status: 'ready', result: first.result });
    expect(mocked.calls).toHaveLength(1);
    const rows = await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'mindmap'").all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ status: 'succeeded', usage_status: 'reported', input_tokens: 1000, output_tokens: 200, total_tokens: 1200, cached_input_tokens: 300, uncached_input_tokens: 700, book_id: book.id });
    const costs = await (await client.fetch(`/api/costs?book=${book.id}&since=0`)).json() as CostSnapshot;
    const item = costs.items.find(i => i.category === 'mindmap')!;
    expect(item.label).toBe('章节思维导图'); expect(item.usd).toBeGreaterThan(0);
    expect(item.tokens).toEqual({ input: 1000, output: 200, cached: 300 });
    expect(costs.items.some(i => i.label === '思维导图请求')).toBe(true);
  });
  it('normalizes complete provider output in one metered call and reuses the saved map', async () => {
    const { post, get } = await setup();
    const output = { text: '知识体系', children: Array.from({ length: 14 }, (_, i) => ({ text: '观点' + i })) };
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(completion({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] })) });
    expect(await (await post()).json()).toMatchObject({ status: 'ready', result: { tree: { children: output.children.map(c => ({ ...c, children: [] })) } } });
    expect(await (await get()).json()).toMatchObject({ status: 'ready', cached: true });
    expect(mocked.calls).toHaveLength(1);
    expect(await env.DB.prepare("SELECT status, input_tokens, output_tokens FROM ai_usage WHERE feature = 'mindmap'").first()).toMatchObject({ status: 'succeeded', input_tokens: 1000, output_tokens: 200 });
  });
  it('preserves rejected complete output privately and reports a specific metered failure', async () => {
    const { user, book, post, get, client } = await setup();
    const raw = JSON.stringify({ text: '章节', children: [{ text: 42 }] });
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(completion({ choices: [{ finish_reason: 'stop', message: { content: raw } }] })) });
    expect((await post()).status).toBe(502);
    const row = await env.DB.prepare('SELECT operation_id FROM mindmaps').first<any>();
    const key = `users/${user.id}/books/${book.id}/mindmaps/${await sha256Hex(target)}.rejected.json`;
    expect(await (await env.BOOKS.get(key))!.json()).toMatchObject({ content: raw, operationId: row.operation_id });
    expect(await (await get()).json()).toMatchObject({ status: 'failed', message: expect.stringContaining('结构校验未通过') });
    expect(await env.DB.prepare("SELECT status, error_code, output_tokens FROM ai_usage WHERE feature = 'mindmap'").first()).toMatchObject({ status: 'failed', error_code: 'mindmap_label', output_tokens: 200 });
    expect(await (await client.fetch(`/api/books/${book.id}/mindmaps`)).json()).toEqual({ readyTargets: [], pending: false });
    expect(mocked.calls).toHaveLength(1);
    await client.fetch(`/api/books/${book.id}`, { method: 'DELETE' });
    expect(await env.BOOKS.get(key)).toBeNull();
  });
  it('keeps failure usage and does not claim retention when rejected-output persistence fails', async () => {
    const { te, post } = await setup();
    vi.spyOn(te.env.BOOKS, 'put').mockRejectedValue(new Error('R2 unavailable'));
    mockFetch({ 'https://llm.test/chat/completions': () => Response.json(completion({ choices: [{ finish_reason: 'stop', message: { content: '{' } }] })) });
    const res = await post();
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.error.code).toBe('mindmap_json');
    expect(body.error.message).not.toContain('已保留');
    expect(await env.DB.prepare("SELECT status, output_tokens FROM ai_usage WHERE feature = 'mindmap'").first()).toMatchObject({ status: 'failed', output_tokens: 200 });
  });
  it('recovers a previously rejected output with a compatible parser without inference or additional usage rows', async () => {
    const { user, book, post, get } = await setup();
    await env.DB.prepare("INSERT INTO mindmaps VALUES (?, ?, ?, 'prior', 'failed', ?, NULL)").bind(user.id, book.id, target, Date.now()).run();
    const key = `users/${user.id}/books/${book.id}/mindmaps/${await sha256Hex(target)}.rejected.json`;
    const output = { title: '章节', model: 'deepseek-flash', generatedAt: Date.now(), operationId: 'wrong-operation', content: JSON.stringify({ text: '章节', children: [{ text: '观点' }] }) };
    await env.BOOKS.put(key, JSON.stringify(output));
    const mocked = mockFetch({});
    expect(await (await get()).json()).toMatchObject({ status: 'failed' });
    await env.BOOKS.put(key, JSON.stringify({ ...output, operationId: 'prior' }));
    expect(await (await get()).json()).toMatchObject({ status: 'ready', cached: true, result: { operationId: 'prior', tree: { children: [{ text: '观点', children: [] }] } } });
    expect(await (await post({ target, retry: true })).json()).toMatchObject({ status: 'ready', cached: true });
    expect(mocked.calls).toHaveLength(0);
    expect((await env.DB.prepare("SELECT id FROM ai_usage WHERE feature = 'mindmap'").all()).results).toHaveLength(0);
  });
  it('uses database admission to coalesce simultaneous generation across requests', async () => {
    const { post } = await setup();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r);
    const mocked = mockFetch({ 'https://llm.test/chat/completions': async () => { entered(); await gate; return Response.json(completion()); } });
    const first = post(); await started;
    expect(await (await post()).json()).toEqual({ status: 'running' });
    release(); expect((await first).status).toBe(200);
    expect(mocked.calls).toHaveLength(1);
  });
  it('enforces authentication and ownership before accessing maps or invoking a provider', async () => {
    const { te, endpoint } = await setup();
    const mocked = mockFetch({});
    expect((await new Client(te).fetch(endpoint + '?target=x')).status).toBe(401);
    expect((await new Client(te).fetch(endpoint + 's')).status).toBe(401);
    const other = new Client(te); await other.login('other@example.com');
    expect((await other.fetch(endpoint, { method: 'POST', json: { target } })).status).toBe(404);
    expect((await other.fetch(endpoint + 's')).status).toBe(404);
    expect(mocked.calls).toHaveLength(0);
  });
  it('records tokens for invalid completions, never automatically regenerates a failed result, and meters explicit retries separately', async () => {
    const { post } = await setup(); let attempts = 0;
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(++attempts === 1 ? completion({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }) : completion()) });
    expect((await post()).status).toBe(502);
    expect(await (await post()).json()).toMatchObject({ status: 'failed' });
    expect(mocked.calls).toHaveLength(1);
    const failed = await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'mindmap'").first<any>();
    expect(failed).toMatchObject({ status: 'failed', error_code: 'mindmap_truncated', input_tokens: 1000, output_tokens: 200 });
    expect((await post({ target, retry: true })).status).toBe(200);
    expect((await env.DB.prepare("SELECT id FROM ai_usage WHERE feature = 'mindmap'").all()).results).toHaveLength(2);
  });
  it('does not call AI if durable metering cannot be started', async () => {
    const { te, post } = await setup();
    const prepare = te.env.DB.prepare.bind(te.env.DB);
    vi.spyOn(te.env.DB, 'prepare').mockImplementation(sql => { if (sql.includes('INSERT INTO ai_usage')) throw new Error('D1 down'); return prepare(sql); });
    const mocked = mockFetch({});
    expect((await post()).status).toBe(503); expect(mocked.calls).toHaveLength(0);
  });
  it('recovers paid results from R2 if final D1 persistence fails, without another model call', async () => {
    const { te, post, get, client, book } = await setup();
    const prepare = te.env.DB.prepare.bind(te.env.DB);
    vi.spyOn(te.env.DB, 'prepare').mockImplementation(sql => { if (sql.includes("SET status = 'ready'")) throw new Error('D1 down'); return prepare(sql); });
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(completion()) });
    expect(await (await post()).json()).toMatchObject({ status: 'ready', cached: false });
    expect(await (await get()).json()).toMatchObject({ status: 'ready', cached: true, result: { tree } });
    expect(await (await post()).json()).toMatchObject({ status: 'ready', cached: true });
    expect(await (await client.fetch(`/api/books/${book.id}/mindmaps`)).json()).toEqual({ readyTargets: [target], pending: false });
    expect(mocked.calls).toHaveLength(1);
  });
  it('keeps unknown interrupted jobs locked and removes cached results when a book is deleted', async () => {
    const { user, book, post, client } = await setup();
    await env.DB.prepare("INSERT INTO mindmaps VALUES (?, ?, ?, 'lost', 'running', ?, NULL)").bind(user.id, book.id, target, Date.now() - 200_000).run();
    const mocked = mockFetch({});
    expect(await (await post()).json()).toMatchObject({ status: 'interrupted' });
    expect(await (await post({ target, retry: true })).json()).toMatchObject({ status: 'interrupted' });
    expect(mocked.calls).toHaveLength(0);
    await env.BOOKS.put(`users/${user.id}/books/${book.id}/mindmaps/recovery.json`, '{}');
    expect((await client.fetch(`/api/books/${book.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await env.DB.prepare('SELECT * FROM mindmaps').all()).results).toHaveLength(0);
    expect((await env.BOOKS.list({ prefix: `users/${user.id}/books/${book.id}/mindmaps/` })).objects).toHaveLength(0);
  });
});

describe('highlight mind maps', () => {
  const quote = '白话文改变了文学的表达方式，也使新的观念能够传播给更多读者。';
  const annotationId = 'highlight-map-01', highlightTarget = 'annotation:' + annotationId;
  async function highlighted(text = quote) {
    const ctx = await setup();
    const response = await ctx.client.fetch(`/api/books/${ctx.book.id}/annotations`, { method: 'POST', json: {
      id: annotationId, kind: 'highlight', color: 'green', anchor: { chapter: 0, start: 5, end: 5 + text.length }, text,
    } });
    expect(response.status).toBe(201);
    return { ...ctx, postHighlight: (retry = false) => ctx.post({ target: highlightTarget, retry }),
      getHighlight: () => ctx.client.fetch(ctx.endpoint + '?target=' + encodeURIComponent(highlightTarget)) };
  }
  it('uses only the saved highlight, preserves its source, reuses across clients and style changes, and meters separately', async () => {
    const { te, client, book, postHighlight, getHighlight, post } = await highlighted();
    const mocked = mockFetch({ 'https://llm.test/chat/completions': async req => {
      const body = await req.json() as any;
      const source = JSON.parse(body.messages[1].content);
      if (mocked.calls.length === 1) { expect(source.text).toBe(quote); expect(source.text).not.toContain('ALPHA'); }
      return Response.json(completion());
    } });
    const first = await (await postHighlight()).json() as MindmapState;
    expect(first).toMatchObject({ status: 'ready', cached: false, result: { tree, source: { annotationId, quote } } });
    await client.fetch(`/api/books/${book.id}/annotations/${annotationId}`, { method: 'PATCH', json: { kind: 'underline', color: 'blue' } });
    expect(await (await postHighlight(true)).json()).toMatchObject({ status: 'ready', cached: true, result: first.result });
    const second = new Client(te); second.cookie = client.cookie;
    expect(await (await second.fetch(`${'/api/books/' + book.id}/mindmap?target=${encodeURIComponent(highlightTarget)}`)).json()).toMatchObject({ result: first.result });
    expect(await (await client.fetch(`/api/books/${book.id}/mindmaps`)).json()).toEqual({ readyTargets: [highlightTarget], pending: false });
    expect(mocked.calls).toHaveLength(1);
    const costs = await (await client.fetch(`/api/costs?book=${book.id}&since=0`)).json() as CostSnapshot;
    const item = costs.items.find(i => i.category === 'highlight_mindmap')!;
    expect(item.label).toBe('划线思维导图'); expect(item.usd).toBeGreaterThan(0);
    expect(item.tokens).toEqual({ input: 1000, output: 200, cached: 300 });
    // A chapter map uses a separate cache key; deleting the mark does not erase a paid result.
    expect((await post()).status).toBe(200);
    await client.fetch(`/api/books/${book.id}/annotations/${annotationId}`, { method: 'DELETE' });
    expect(await (await getHighlight()).json()).toMatchObject({ result: first.result });
    expect(mocked.calls).toHaveLength(2);
    await client.fetch(`/api/books/${book.id}`, { method: 'DELETE' });
    expect((await getHighlight()).status).toBe(404);
    expect((await env.DB.prepare('SELECT * FROM mindmaps').all()).results).toHaveLength(0);
  });
  it('supports short highlights without padding their text or reading the whole archive', async () => {
    const { te, book, postHighlight } = await highlighted('义法');
    await te.env.BOOKS.delete(book.file_key);
    const mocked = mockFetch({ 'https://llm.test/chat/completions': async req => {
      const body = await req.json() as any;
      expect(JSON.parse(body.messages[1].content).text).toBe('义法');
      expect(body.messages[0].content).toContain('do not invent details');
      return Response.json(completion());
    } });
    expect(await (await postHighlight()).json()).toMatchObject({ status: 'ready', result: { source: { quote: '义法' } } });
    expect(mocked.calls).toHaveLength(1);
  });
  it('rejects missing/foreign/empty annotations and injected passage text before any paid call', async () => {
    const { te, client, book, endpoint, postHighlight } = await highlighted('');
    const mocked = mockFetch({});
    expect((await postHighlight()).status).toBe(422);
    expect((await client.fetch(endpoint, { method: 'POST', json: { target: 'annotation:missing-000' } })).status).toBe(404);
    expect((await client.fetch(endpoint, { method: 'POST', json: { target: 'annotation:bad/path' } })).status).toBe(400);
    expect((await client.fetch(endpoint, { method: 'POST', json: { target: highlightTarget, text: quote } })).status).toBe(400);
    const other = new Client(te); await other.login('other-highlight@example.com');
    expect((await other.fetch(endpoint, { method: 'POST', json: { target: highlightTarget } })).status).toBe(404);
    const form = new FormData(); form.set('file', new File([fixture()], 'other.epub'));
    const { book: another } = await (await other.fetch('/api/books', { method: 'POST', body: form })).json() as any;
    expect(another.id).not.toBe(book.id);
    expect((await other.fetch(`/api/books/${another.id}/mindmap`, { method: 'POST', json: { target: highlightTarget } })).status).toBe(404);
    expect(mocked.calls).toHaveLength(0);
    expect((await env.DB.prepare('SELECT * FROM mindmaps').all()).results).toHaveLength(0);
    expect((await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'highlight_mindmap'").all()).results).toHaveLength(0);
  });
  it('coalesces concurrent generation and preserves the complete source during R2 recovery', async () => {
    const { te, postHighlight, getHighlight } = await highlighted();
    let release!: () => void, announce!: () => void;
    const started = new Promise<void>(r => { announce = r; }), gate = new Promise<void>(r => { release = r; });
    const mocked = mockFetch({ 'https://llm.test/chat/completions': async () => { announce(); await gate; return Response.json(completion()); } });
    const prepare = te.env.DB.prepare.bind(te.env.DB);
    vi.spyOn(te.env.DB, 'prepare').mockImplementation(sql => { if (sql.includes("SET status = 'ready'")) throw new Error('D1 down'); return prepare(sql); });
    const first = postHighlight(); await started;
    expect(await (await postHighlight()).json()).toEqual({ status: 'running' });
    release(); expect((await first).status).toBe(200);
    expect(await (await getHighlight()).json()).toMatchObject({ status: 'ready', cached: true, result: { source: { annotationId, quote } } });
    expect(mocked.calls).toHaveLength(1);
    expect(await env.DB.prepare("SELECT feature, input_tokens, output_tokens FROM ai_usage WHERE feature = 'highlight_mindmap'").first()).toMatchObject({ feature: 'highlight_mindmap', input_tokens: 1000, output_tokens: 200 });
  });
  it('records failed highlight tokens and reads the reason without automatically retrying', async () => {
    const { postHighlight, getHighlight } = await highlighted();
    let attempts = 0;
    const mocked = mockFetch({ 'https://llm.test/chat/completions': () => Response.json(++attempts === 1 ? completion({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }) : completion()) });
    expect((await postHighlight()).status).toBe(502);
    expect(await (await getHighlight()).json()).toMatchObject({ status: 'failed', message: expect.stringContaining('长度上限') });
    expect(await (await postHighlight()).json()).toMatchObject({ status: 'failed' });
    expect(mocked.calls).toHaveLength(1);
    expect(await env.DB.prepare("SELECT status, error_code, output_tokens FROM ai_usage WHERE feature = 'highlight_mindmap'").first()).toMatchObject({ status: 'failed', error_code: 'mindmap_truncated', output_tokens: 200 });
    expect((await postHighlight(true)).status).toBe(200);
    expect((await env.DB.prepare("SELECT id FROM ai_usage WHERE feature = 'highlight_mindmap'").all()).results).toHaveLength(2);
  });
});
