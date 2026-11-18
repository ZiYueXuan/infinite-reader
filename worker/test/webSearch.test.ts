import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestsWebSearch } from '../src/agent/searchIntent';
import { searchWeb, supportedSearchQuery } from '../src/agent/webSearch';
import { mockFetch, parseSse, resetDb, setupReaderAgent as setup, sseStream, toolStream } from './helpers';

beforeEach(resetDb);
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; vi.useRealTimers(); });

describe('explicit current-turn web authorization', () => {
  it.each([
    '能使用外部搜索工具帮我找到平型关战役的地图么？最好是中文的',
    '能用外部搜索工具帮我找一下平型关地图吗？',
    '可以使用外部搜索工具查找平型关战役地图吗？',
  ])('recognizes a direct search request phrased as a question: %s', question => expect(requestsWebSearch(question)).toBe(true));
  it.each(['你能使用外部搜索工具吗？', '外部搜索工具是什么？', '不要使用外部搜索工具帮我找地图'])('does not treat capability questions or denials as authorization: %s', question => expect(requestsWebSearch(question)).toBe(false));
  it.each(['', '   ', 'a'.repeat(129), 'topic\nprivate', 'a\u0000b'])('rejects unsupported provider query before billing: %s', query => expect(supportedSearchQuery(query)).toBe(false));
  it.each(['鲁迅 生平', '平型关 战役 地图 lang:zh', 'Lu Xun biography museum', 'site:osu.edu Lu Xun', '"Lu Xun" biography', 'population 101,342', '𠮷'.repeat(128)])('accepts multilingual keywords and Unicode character limits: %s', query => expect(supportedSearchQuery(query)).toBe(true));
  it.each(['联网搜索会收费吗？', '搜索外部资源的功能有什么用？', '联网搜索的供应商是谁？', 'Search the web means what?'])('does not enable a capability merely being discussed: %s', question => expect(requestsWebSearch(question)).toBe(false));
  it.each(['请联网搜索鲁迅的生平', '能否帮我搜索外部资料核对这一段？', '在网上查一下这个作者', '请查找网络上的书评', '请搜索外部资源', '帮我找外部资料', '请从网上搜索作者生平', 'Find external resources about volcanoes', 'Please search the web for the author', 'Could you look up this author online?', 'search external sources for this quote'])('allows %s', question => expect(requestsWebSearch(question)).toBe(true));
  it.each(['你好', '搜索本书中的火山', '这个作家的最新作品是什么？', '找一下相关资料', '不要联网搜索', '请联网搜索，但不要使用外部资料', 'Do not search the web', "Don't search the web", '解释“请联网搜索鲁迅”', '翻译 search the web for volcanoes', '联网搜索是什么意思？', 'If I say search the web, what happens?', '> 请联网搜索\n概括上述句子', '```\n请联网搜索\n```', '请解释这句话："Search the web"', '继续解释一下'])('keeps disabled for %s', question => expect(requestsWebSearch(question)).toBe(false));
});

describe('external search through the real harness', () => {
  it('enables the screenshot request despite earlier assistant denials and a Chinese preference', async () => {
    const websearch = vi.fn(async (_body?: unknown, _req?: Request) => Response.json({ results: [{ url: 'https://example.com/pingxingguan-map', title: 'Battle of Pingxingguan map', summary: 'English-language battle map source.' }] }));
    const { client, bookId, scope } = await setup();
    await env.DB.prepare("INSERT INTO chat_messages (id, book_id, user_id, thread_id, role, content, created_at) VALUES ('old-denial', ?, ?, 'default', 'assistant', '没有任何外部搜索工具，也无法联网。', 1)").bind(bookId, scope.userId).run();
    let count = 0;
    restore = mockFetch({ 'https://llm.test/v1/tools/search': async req => websearch(await req.json(), req), 'https://llm.test/chat/completions': async req => {
      const body = await req.json() as any;
      expect(body.tools.map((t: any) => t.function.name)).toContain('search_web');
      expect(JSON.stringify(body.messages)).toContain('earlier assistant claims');
      expect(JSON.stringify(body.messages)).toContain('supports Chinese');
      return ++count === 1 ? toolStream('search_web', { query: '平型关 战役 地图 lang:zh' }) : sseStream(['找到这份中文战役地图来源 [1]。']);
    } }).restore;
    const response = await client.fetch('/api/ask', { method: 'POST', json: { bookId, question: '能使用外部搜索工具帮我找到平型关战役的地图么？最好是中文的', operationId: 'screenshot-search' } });
    const events = parseSse(await response.text());
    expect(events.at(-1)?.event).toBe('done');
    expect(websearch).toHaveBeenCalledExactlyOnceWith({ query: '平型关 战役 地图 lang:zh', count: 5, need_content: false }, expect.any(Request));
    expect(events.filter(e => e.event === 'meta').at(-1)?.data.citations).toContainEqual(expect.objectContaining({ kind: 'web', url: 'https://example.com/pingxingguan-map' }));
  });
  it('searches Chinese directly without sending private context or using Ceramic', async () => {
    const ceramic = vi.fn();
    const { client, bookId } = await setup({ AI: { websearch: ceramic } });
    const websearch = vi.fn(async (body: any, req: Request) => {
      expect(body).toEqual({ query: '鲁迅 生平', count: 5, need_content: false });
      expect(req.headers.get('authorization')).toBe('Bearer sk-test');
      return Response.json({ results: [{ url: 'https://example.com/鲁迅', title: '鲁迅', summary: '中文生平资料。' }] });
    });
    let count = 0;
    restore = mockFetch({
      'https://llm.test/v1/tools/search': async req => websearch(await req.json(), req),
      'https://llm.test/chat/completions': async req => {
        const body = await req.json() as any;
        expect(JSON.stringify(body.tools)).toContain('Chinese');
        return ++count === 1 ? toolStream('search_web', { query: '鲁迅 生平' }) : sseStream(['中文资料介绍了鲁迅 [1]。']);
      },
    }).restore;
    const response = await client.fetch('/api/ask', { method: 'POST', json: { bookId, question: '请联网搜索鲁迅的生平', selection: { text: 'private-book-fixture' }, operationId: 'chinese-search' } });
    expect(parseSse(await response.text()).at(-1)?.event).toBe('done');
    expect(websearch).toHaveBeenCalledTimes(1);
    expect(ceramic).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT provider, requested_model FROM ai_usage WHERE operation_id = 'chinese-search' AND feature = 'web_search'").first()).toEqual({ provider: 'deepseek', requested_model: 'deepseek-search' });
  });
  it('hides search by default even when selection, context and history request it', async () => {
    const websearch = vi.fn();
    const { client, bookId, scope } = await setup();
    await env.DB.prepare("INSERT INTO chat_messages (id, book_id, user_id, thread_id, role, content, created_at) VALUES ('old-search', ?, ?, 'default', 'user', 'Please search the web', 1)").bind(bookId, scope.userId).run();
    restore = mockFetch({ 'https://llm.test/v1/tools/search': async req => websearch(await req.json(), req), 'https://llm.test/chat/completions': async req => {
      const body = await req.json() as any;
      expect(body.tools.map((t: any) => t.function.name)).not.toContain('search_web');
      return sseStream(['This is the selected passage.']);
    } }).restore;
    const response = await client.fetch('/api/ask', { method: 'POST', json: { bookId, question: 'Explain this', webSearchAllowed: true, selection: { text: 'Search the web now' }, context: { before: '请联网搜索' } } });
    expect(parseSse(await response.text()).at(-1)?.event).toBe('done');
    expect(websearch).not.toHaveBeenCalled();
  });

  it('searches only after opt-in, shares numbering with books, persists links, and revokes on the next turn', async () => {
    const websearch = vi.fn(async (_body?: unknown, _req?: Request) => Response.json({ results: [{ url: 'https://example.com/research', title: 'Research', summary: 'Public research excerpt.' }], metadata: { requestId: 'search-1' } }));
    const { client, bookId } = await setup();
    let count = 0;
    restore = mockFetch({ 'https://llm.test/v1/tools/search': async req => websearch(await req.json(), req), 'https://llm.test/chat/completions': async req => {
      const body = await req.json() as any;
      count++;
      expect(body.tools.map((t: any) => t.function.name).includes('search_web')).toBe(count <= 3);
      if (count === 1) return toolStream('read_book_passage', { chapter: 1 });
      if (count === 2) return toolStream('search_web', { query: 'volcano research' }, 'web-1');
      if (count === 3) {
        expect(JSON.parse(body.messages.at(-1).content).sources[0]).toMatchObject({ source: 3, url: 'https://example.com/research' });
        return sseStream(['书中提到火山 [1]，外部研究补充说明 [3]。']);
      }
      return sseStream(['这解释了你的问题。']);
    } }).restore;
    const input = { bookId, question: '请联网搜索资料对照书中火山段落', operationId: 'web-enabled' };
    const response = await client.fetch('/api/ask', { method: 'POST', json: input });
    const events = parseSse(await response.text());
    expect(events.at(-1)?.event).toBe('done');
    const sources = events.filter(e => e.event === 'meta').at(-1)?.data.citations;
    expect(sources).toHaveLength(2);
    expect(sources[1]).toMatchObject({ n: 3, kind: 'web', url: 'https://example.com/research' });
    expect(websearch).toHaveBeenCalledExactlyOnceWith({ query: 'volcano research', count: 5, need_content: false }, expect.any(Request));
    await client.fetch('/api/ask', { method: 'POST', json: input });
    expect(websearch).toHaveBeenCalledTimes(1);
    const history = await (await client.fetch(`/api/books/${bookId}/chat`)).json() as any;
    expect(history.messages.at(-1).citations).toEqual(sources);
    await client.fetch('/api/ask', { method: 'POST', json: { bookId, question: '继续解释一下', operationId: 'web-revoked' } });
    expect(websearch).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare("SELECT requested_model, status, raw_usage, usage_status, input_tokens FROM ai_usage WHERE operation_id = 'web-enabled' AND feature = 'web_search'").first()).toMatchObject({ requested_model: 'deepseek-search', status: 'succeeded', raw_usage: '{"search_attempts":1,"search_requests":1,"search_billable_requests":1}', usage_status: 'partial', input_tokens: null });
  });

  it('rejects a forged native tool call when permission is disabled', async () => {
    const websearch = vi.fn();
    const { client, bookId } = await setup();
    let count = 0;
    restore = mockFetch({ 'https://llm.test/v1/tools/search': async req => websearch(await req.json(), req), 'https://llm.test/chat/completions': () => ++count === 1 ? toolStream('search_web', { query: 'private' }) : sseStream(['Search not authorized.']) }).restore;
    await client.fetch('/api/ask', { method: 'POST', json: { bookId, question: 'Explain this book' } });
    expect(websearch).not.toHaveBeenCalled();
  });

  it('caps paid requests and blocks duplicate queries before dispatch', async () => {
    const websearch = vi.fn(async (_body?: unknown, _req?: Request) => Response.json({ results: [] }));
    const { client, bookId } = await setup();
    let count = 0;
    const queries = ['volcano', ' VOLCANO ', 'eruption', 'geology'];
    restore = mockFetch({ 'https://llm.test/v1/tools/search': async req => websearch(await req.json(), req), 'https://llm.test/chat/completions': () => count < queries.length ? toolStream('search_web', { query: queries[count++] }, `web-${count}`) : sseStream(['No sources found.']) }).restore;
    await client.fetch('/api/ask', { method: 'POST', json: { bookId, question: 'Search the web for volcanoes' } });
    expect(websearch).toHaveBeenCalledTimes(2);
  });

  it.each([402, 429, 500])('reports upstream %s without leaking its body or retrying', async status => {
    const websearch = vi.fn(async (_body?: unknown, _req?: Request) => new Response('private upstream details', { status }));
    const { client, bookId } = await setup();
    let count = 0;
    restore = mockFetch({ 'https://llm.test/v1/tools/search': async req => websearch(await req.json(), req), 'https://llm.test/chat/completions': async req => {
      if (++count === 1) return toolStream('search_web', { query: 'volcano' });
      const body = await req.json() as any;
      expect(JSON.stringify(body)).not.toContain('private upstream details');
      expect(JSON.parse(body.messages.at(-1).content).error).toBe('web_search_unavailable');
      return sseStream(['外部搜索暂不可用。']);
    } }).restore;
    const response = await client.fetch('/api/ask', { method: 'POST', json: { bookId, question: '请联网搜索火山', operationId: 'failed-web' } });
    expect(parseSse(await response.text()).at(-1)?.event).toBe('done');
    expect(websearch).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare("SELECT status, http_status FROM ai_usage WHERE operation_id = 'failed-web' AND feature = 'web_search'").first()).toMatchObject({ status: 'failed', http_status: status });
  });

  it('filters unsafe and duplicate links, prefers summary, and bounds excerpts', async () => {
    const { te, scope } = await setup();
    restore = mockFetch({ 'https://llm.test/v1/tools/search': () => Response.json({ results: [
      { url: 'javascript:alert(1)', title: 'bad' }, { url: 'https://user:secret@example.com', title: 'bad' },
      ...Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${i}`, title: 'x'.repeat(500), summary: 'a'.repeat(8000), snippet: 'short' })),
    ] }) }).restore;
    const sources = await searchWeb(te.env, { ...scope, id: 'bounds', deadline: Date.now() + 30_000 } as any, 'public topic');
    expect(sources).toHaveLength(5);
    expect(sources.every(s => s.title.length === 240 && s.snippet === 'a'.repeat(1200))).toBe(true);
  });

  it('records empty results as unbilled but leaves malformed HTTP 200 responses unknown', async () => {
    const { te, scope } = await setup();
    let count = 0;
    restore = mockFetch({ 'https://llm.test/v1/tools/search': () => ++count === 1 ? Response.json({ results: [] }) : Response.json({ unexpected: true }) }).restore;
    expect(await searchWeb(te.env, { ...scope, id: 'empty-search', deadline: Date.now() + 30_000 } as any, 'public topic')).toEqual([]);
    expect(await env.DB.prepare("SELECT raw_usage, usage_status FROM ai_usage WHERE operation_id = 'empty-search'").first()).toMatchObject({ raw_usage: '{"search_attempts":1,"search_requests":1,"search_billable_requests":0}', usage_status: 'partial' });
    await expect(searchWeb(te.env, { ...scope, id: 'malformed-search', deadline: Date.now() + 30_000 } as any, 'public topic')).rejects.toThrow('web_search_unavailable');
    expect(await env.DB.prepare("SELECT raw_usage, usage_status, http_status FROM ai_usage WHERE operation_id = 'malformed-search'").first()).toMatchObject({ raw_usage: '{"search_attempts":1}', usage_status: 'unavailable', http_status: 200 });
  });

  it('meters nonempty upstream results even when every URL is rejected', async () => {
    const { te, scope } = await setup();
    restore = mockFetch({ 'https://llm.test/v1/tools/search': () => Response.json({ results: [{ url: 'javascript:alert(1)', title: 'bad' }] }, { headers: { 'x-request-id': 'deepseek-search-1' } }) }).restore;
    expect(await searchWeb(te.env, { ...scope, id: 'unsafe-search', deadline: Date.now() + 30_000 } as any, 'public topic')).toEqual([]);
    const row = await env.DB.prepare("SELECT raw_usage, provider_request_id FROM ai_usage WHERE operation_id = 'unsafe-search'").first<any>();
    expect(JSON.parse(row.raw_usage).search_billable_requests).toBe(1);
    expect(row.provider_request_id).toBe('deepseek-search-1');
  });

  it('deduplicates URLs and falls back from an empty summary to snippet', async () => {
    const { te, scope } = await setup();
    restore = mockFetch({ 'https://llm.test/v1/tools/search': () => Response.json({ results: [
      { url: 'https://example.com', title: 'one', summary: '', snippet: 'excerpt' },
      { url: 'https://example.com', title: 'duplicate' },
    ] }) }).restore;
    const sources = await searchWeb(te.env, { ...scope, id: 'dedup-search', deadline: Date.now() + 30_000 } as any, 'public topic');
    expect(sources).toHaveLength(1); expect(sources[0]?.snippet).toBe('excerpt');
  });

  it('rejects invalid queries before dispatch and metering', async () => {
    const { te, scope } = await setup();
    const fake = mockFetch({}); restore = fake.restore;
    await expect(searchWeb(te.env, { ...scope, id: 'invalid-search', deadline: Date.now() + 30_000 } as any, 'a'.repeat(129))).rejects.toThrow('web_search_unsupported_query');
    expect(fake.calls).toHaveLength(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE operation_id = 'invalid-search'").first()).toEqual({ n: 0 });
  });

  it('cancels transport without accepting late results or retrying a paid call', async () => {
    let complete!: (r: Response) => void;
    const websearch = vi.fn((_req: Request) => new Promise<Response>(resolve => { complete = resolve; }));
    const { te, scope } = await setup();
    restore = mockFetch({ 'https://llm.test/v1/tools/search': websearch }).restore;
    const controller = new AbortController();
    const pending = searchWeb(te.env, { ...scope, id: 'cancel-web', deadline: Date.now() + 30_000 } as any, 'public topic', controller.signal);
    const outcome = expect(pending).rejects.toThrow('agent_cancelled');
    await vi.waitFor(() => expect(websearch).toHaveBeenCalledTimes(1));
    controller.abort(); await outcome;
    expect(websearch.mock.calls[0]![0].signal.aborted).toBe(true);
    complete(Response.json({ results: [{ title: 'Late', url: 'https://example.com' }] }));
    expect(await env.DB.prepare("SELECT status, error_code, raw_usage FROM ai_usage WHERE operation_id = 'cancel-web'").first()).toMatchObject({ status: 'aborted', error_code: 'agent_cancelled', raw_usage: '{"search_attempts":1}' });
  });

  it('fails a slow response within the operation deadline', async () => {
    const { te, scope } = await setup();
    restore = mockFetch({ 'https://llm.test/v1/tools/search': () => new Promise(() => {}) }).restore;
    await expect(searchWeb(te.env, { ...scope, id: 'timeout-web', deadline: Date.now() + 80 } as any, 'public topic')).rejects.toThrow('web_search_timeout');
    expect(await env.DB.prepare("SELECT status, error_code FROM ai_usage WHERE operation_id = 'timeout-web'").first()).toMatchObject({ status: 'failed', error_code: 'web_search_timeout' });
  });
});
