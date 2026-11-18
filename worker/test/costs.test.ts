import { canViewCostDebug } from '../src/lib/costAccess';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, resetDb, buildEpub } from './helpers';
import { priceAi, priceInfra, type UsageRow } from '../src/lib/costPricing';
import { createCostMeter } from '../src/lib/costMeter';
import { startAiCall } from '../src/lib/aiUsage';
import type { CostSnapshot } from '../../shared/costs';

const row = (patch: Partial<UsageRow> = {}): UsageRow => ({
  id: 'call', operation_id: 'operation', book_id: null, feature: 'ask', provider: 'deepseek',
  requested_model: 'deepseek-chat', response_model: 'deepseek-flash', status: 'succeeded',
  started_at: Date.parse('2026-10-28T17:00:00Z'), input_tokens: 1000, output_tokens: 100,
  cached_input_tokens: 200, input_characters: null, raw_usage: null, ...patch,
});
describe('cost pricing', () => {
  const deepseekSearch = (patch: Partial<UsageRow> = {}) => row({ feature: 'web_search', provider: 'deepseek', requested_model: 'deepseek-search', response_model: null,
    input_tokens: null, output_tokens: null, cached_input_tokens: null, http_status: 200,
    raw_usage: '{"search_attempts":1,"search_requests":1,"search_billable_requests":1}', ...patch });
  it('prices DeepSeek independently from historical Ceramic fees and model tokens', () => {
    const cost = priceAi(deepseekSearch());
    expect(cost).toMatchObject({ usd: .00075, lowUsd: .00075, basis: 'estimated', search: { billedRequests: 1, attempts: 1, pricingVersion: '2026-11-14' } });
    expect(cost.parts).toHaveLength(1);
    expect(cost.parts[0]?.label).toBe('DeepSeek 搜索');
    expect(priceAi(deepseekSearch({ input_tokens: 5000, output_tokens: 5000, status: 'aborted' })).usd).toBe(.00075);
  });
  it('prices observed empty results and provider failures at zero without guessing cancelled charges', () => {
    expect(priceAi(deepseekSearch({ raw_usage: '{"search_attempts":1,"search_requests":1,"search_billable_requests":0}' })).usd).toBe(0);
    for (const http_status of [400, 401, 402, 429, 500, 504]) {
      expect(priceAi(deepseekSearch({ status: 'failed', http_status, raw_usage: '{"search_attempts":1,"search_requests":0,"search_billable_requests":0}' })).usd).toBe(0);
    }
    for (const raw_usage of [null, '{}', '{"search_attempts":1}', '{"search_billable_requests":0}', '{"search_requests":1,"search_billable_requests":2}', '{"search_requests":1,"search_billable_requests":"1"}']) {
      expect(priceAi(deepseekSearch({ raw_usage })).usd).toBeNull();
    }
    expect(priceAi(deepseekSearch({ status: 'started' })).usd).toBeNull();
    expect(priceAi(deepseekSearch({ http_status: 500 })).usd).toBeNull();
  });
  const searchRow = (patch: Partial<UsageRow> = {}) => row({ feature: 'web_search', provider: 'cloudflare', requested_model: 'ceramic', response_model: null,
    input_tokens: null, output_tokens: null, cached_input_tokens: null, raw_usage: '{"search_requests":1}', http_status: 200, ...patch });
  it('backfills old successful search counters and separates search price from credit purchase fees', () => {
    const cost = priceAi(searchRow({ provider_request_id: 'provider-1' }));
    expect(cost).toMatchObject({ label: '外部搜索', basis: 'estimated', search: { requests: 1, attempts: 1, httpStatus: 200, providerRequestId: 'provider-1', pricingVersion: '2026-11-12' } });
    expect(cost.parts.map(p => p.usd)).toEqual([.00025, .0000125]);
    expect(cost.usd).toBeCloseTo(.0002625, 12);
    expect(cost.lowUsd).toBe(cost.usd);
    // Search accounting must never also charge tokens/neurons on the same row.
    expect(priceAi(searchRow({ input_tokens: 10000, output_tokens: 10000, raw_usage: '{"search_requests":1,"neurons":10000}' })).usd).toBe(cost.usd);
    // Response receipt can precede cancellation or a later application failure.
    expect(priceAi(searchRow({ status: 'aborted' })).usd).toBe(cost.usd);
  });
  it('keeps unconfirmed search charges unknown instead of pricing attempts or inventing zero', () => {
    for (const raw_usage of [null, '{}', '{"search_attempts":1}', '{"search_requests":0}', '{"search_requests":-1}', '{"search_requests":1.5}', '{"search_requests":2}', '{"search_requests":"1"}', 'broken']) {
      for (const status of ['failed', 'aborted', 'succeeded']) {
        expect(priceAi(searchRow({ raw_usage, status }))).toMatchObject({ usd: null, basis: 'unavailable', parts: [] });
      }
    }
    for (const patch of [{ status: 'started' }, { provider: 'other' }, { requested_model: 'other' }, { http_status: 500 }]) {
      expect(priceAi(searchRow(patch)).usd).toBeNull();
    }
    expect(priceAi(searchRow({ status: 'failed', raw_usage: '{"search_attempts":1}', http_status: 502, error_code: 'web_search_unavailable' })).search)
      .toMatchObject({ requests: null, attempts: 1, httpStatus: 502, errorCode: 'web_search_unavailable' });
  });
  it('uses response model and cache split, without charging reasoning twice', () => {
    const cost = priceAi(row({ raw_usage: JSON.stringify({ completion_tokens_details: { reasoning_tokens: 90 } }) }));
    expect(cost.usd).toBeCloseTo((800 * .15 + 200 * .003 + 100 * .6) / 1e6, 12);
    expect(cost.lowUsd).toBe(cost.usd);
    expect(cost.basis).toBe('reported');
  });
  it('shows uncertainty for unknown cache splits and holiday peak windows', () => {
    const cost = priceAi(row({ cached_input_tokens: null, started_at: Date.parse('2026-10-28T02:00:00Z') }));
    expect(cost.usd).toBeCloseTo((1000 * .3 + 100 * 1.2) / 1e6, 12);
    expect(cost.lowUsd).toBeCloseTo((1000 * .006 + 100 * 1.2) / 2e6, 12);
    expect(cost.basis).toBe('estimated');
  });
  it('does not invent zeros or prices for missing, pending, invalid or unknown usage', () => {
    for (const patch of [{ output_tokens: null }, { response_model: null }, { status: 'started' }, { cached_input_tokens: 1001 }]) {
      expect(priceAi(row(patch)).usd).toBeNull();
    }
    expect(priceAi(row({ status: 'failed' })).usd).toBeGreaterThan(0);
    expect(priceAi(row({ input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 })).usd).toBe(0);
  });
  it('prefers reported neurons, and labels character-based embeddings as rough estimates', () => {
    const base = row({ provider: 'cloudflare', requested_model: '@cf/baai/bge-m3', response_model: null, input_tokens: null, output_tokens: null });
    expect(priceAi(base).usd).toBeNull();
    const estimated = priceAi({ ...base, input_characters: 101 });
    expect(estimated.basis).toBe('estimated');
    expect(estimated.usd).toBeCloseTo(51 * .0118 / 1e6, 12);
    const reported = priceAi({ ...base, input_tokens: 100, raw_usage: '{"neurons":10}' });
    expect(reported.usd).toBeCloseTo(.00011, 12);
    expect(reported.parts).toHaveLength(1);
  });
  it('prices separate infrastructure units at list rates', () => {
    expect(priceInfra({ requests: 1, d1Read: 100, d1Written: 2, r2A: 1, r2B: 1, unknown: 0 }).reduce((n, p) => n + p.usd, 0)).toBeCloseTo(.00000726, 12);
  });
});

beforeEach(resetDb);
describe('cost metering and account API', () => {
  it('includes search estimates once in totals, exposes reconciliation details, and keeps unknown attempts visible', async () => {
    const te = makeEnv(), client = new Client(te), { user } = await client.login('cost-admin@example.test');
    const context = { operationId: 'search-cost', userId: user.id, bookId: null, feature: 'web_search' as const, provider: 'cloudflare' as const, model: 'ceramic' };
    for (let i = 0; i < 2; i++) {
      const call = await startAiCall(te.env, context);
      call.http(200); call.observe({ id: `provider-${i}`, usage: { search_attempts: 1, search_requests: 1 } });
      await call.finish({ status: 'succeeded' });
    }
    const failed = await startAiCall(te.env, context);
    failed.http(502); failed.observe({ usage: { search_attempts: 1 } });
    await failed.finish({ status: 'failed', errorCode: 'web_search_unavailable' });
    const model = await startAiCall(te.env, { ...context, feature: 'ask', provider: 'deepseek', model: 'deepseek-flash' });
    model.observe({ model: 'deepseek-flash', usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 0 } });
    await model.finish({ status: 'succeeded' });
    const get = async () => (await (await client.fetch('/api/costs')).json()) as CostSnapshot;
    const result = await get();
    const searches = result.items.filter(i => i.category === 'web_search');
    expect(searches).toHaveLength(3);
    expect(result.unknown).toBe(1);
    expect(result.groups.find(g => g.label === '外部搜索')).toMatchObject({ count: 3, unknown: 1 });
    expect(result.groups.find(g => g.label === '外部搜索')!.usd).toBeCloseTo(.000525, 12);
    expect(result.totalUsd).toBeCloseTo(.000525 + result.items.find(i => i.id === model.id)!.usd!, 12);
    expect(result.items.find(i => i.id === failed.id)).toMatchObject({ usd: null, search: { attempts: 1, requests: null, httpStatus: 502, errorCode: 'web_search_unavailable' } });
    expect(searches.filter(i => i.basis === 'estimated')).toHaveLength(2);
    expect(result.sources.some(s => s.url.endsWith('/web-search/providers/'))).toBe(true);
    expect((await get()).totalUsd).toBe(result.totalUsd);
    // Frequent progress writes must not evict searches from filtered details.
    await te.env.DB.batch(Array.from({ length: 105 }, (_, i) => te.env.DB.prepare('INSERT INTO cost_events (id, user_id, action, status, started_at, metrics) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`progress-${i}`, user.id, '保存进度', 'succeeded', Date.now(), JSON.stringify({ requests: 1 }))));
    const filtered = await (await client.fetch('/api/costs?feature=web_search')).json() as CostSnapshot;
    expect(filtered).toMatchObject({ feature: 'web_search', count: 3, unknown: 1, estimated: 2 });
    expect(filtered.items).toHaveLength(3);
    expect(filtered.items.every(i => i.category === 'web_search')).toBe(true);
    expect(filtered.totalUsd).toBeCloseTo(.000525, 12);
    expect(filtered.groups).toHaveLength(1);
    expect((await client.fetch('/api/costs?feature=invalid')).status).toBe(400);
    expect((await client.fetch('/api/costs?feature=web_search&book=missing')).status).toBe(404);
  });
  it('only allows configured mailboxes and denies bypasses on every cost route', async () => {
    const allowlist = ' Cost-Admin@example.test, operator@example.test ';
    for (const email of ['cost-admin@example.test', ' COST-ADMIN@EXAMPLE.TEST ', 'operator@example.test']) {
      expect(canViewCostDebug(email, allowlist)).toBe(true);
    }
    for (const email of ['', 'reader@example.com', 'cost-admin+tag@example.test', 'cost-admin@example.test.evil.test', 'cost.admin@example.test']) {
      expect(canViewCostDebug(email, allowlist)).toBe(false);
    }
    expect(canViewCostDebug('cost-admin@example.test')).toBe(false);
    const te = makeEnv(), client = new Client(te);
    await client.login('ordinary@example.com');
    expect(await (await client.fetch('/api/auth/me')).json()).toMatchObject({ user: { can_view_cost_debug: false } });
    for (const path of ['/api/costs', '/api/costs/', '/api/costs?since=NaN', '/api/costs?book=missing', '/api/costs?email=cost-admin@example.test&role=admin']) {
      const response = await client.fetch(path, { headers: { 'x-user-email': 'cost-admin@example.test', 'x-role': 'admin' } });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'admin_required' } });
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });
  it('withholds cost access when the server allowlist is unset', async () => {
    const client = new Client(makeEnv({ COST_DEBUG_EMAILS: undefined }));
    const { user } = await client.login('cost-admin@example.test');
    expect(user).toMatchObject({ can_view_cost_debug: false });
    expect((await client.fetch('/api/costs')).status).toBe(403);
  });
  it('preserves real D1 first/batch and R2 semantics, records once, and excludes its own ledger', async () => {
    const te = makeEnv(), client = new Client(te), { user } = await client.login('cost-admin@example.test');
    const meter = createCostMeter(te.env, 1);
    expect(await meter.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(user.id).first('email')).toBe(user.email);
    expect(await meter.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind('absent').first()).toBeNull();
    await expect(meter.env.DB.prepare('SELECT email FROM users').first('missing')).rejects.toThrow('D1_COLUMN_NOTFOUND');
    const batch = await meter.env.DB.batch([meter.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user.id)]);
    expect(batch[0]!.results[0]).toEqual({ id: user.id });
    await meter.env.BOOKS.put('cost-test', 'hello');
    expect(await (await meter.env.BOOKS.get('cost-test'))!.text()).toBe('hello');
    await meter.env.BOOKS.delete('cost-test');
    expect(meter.metrics).toMatchObject({ r2A: 1, r2B: 1, unknown: 0, d1Written: 0 });
    expect(meter.metrics.d1Read).toBeGreaterThan(0);
    const before = { ...meter.metrics };
    await meter.finish(user.id, 'not-owned', 'test', Date.now(), 'succeeded');
    await meter.finish(user.id, null, 'test', Date.now(), 'succeeded');
    expect(meter.metrics).toEqual(before);
    const saved = await te.env.DB.prepare('SELECT * FROM cost_events').all<{ book_id: string | null; metrics: string }>();
    expect(saved.results).toHaveLength(1);
    expect(saved.results[0]!.book_id).toBeNull();
    expect(JSON.parse(saved.results[0]!.metrics)).toEqual(before);
    // Diagnostic insert failure does not break the completed operation.
    await expect(createCostMeter(te.env).finish('missing-user', null, 'test', Date.now(), 'failed')).resolves.toBeUndefined();
  });
  it('requires consent and isolates accounts, reports retries individually, and never meters polling', async () => {
    const te = makeEnv(), first = new Client(te), second = new Client(te);
    expect((await first.fetch('/api/costs')).status).toBe(401);
    const { user: a } = await first.login('cost-admin@example.test');
    const { user: b } = await second.login('second@example.com');
    const context = { operationId: 'same-operation', userId: a.id, bookId: null, feature: 'ask' as const, provider: 'deepseek' as const, model: 'deepseek-flash' };
    const one = await startAiCall(te.env, context);
    one.observe({ model: 'deepseek-flash', usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 0 } });
    await one.finish({ status: 'failed' });
    const two = await startAiCall(te.env, context);
    two.observe({ model: 'deepseek-flash', usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 0 } });
    await two.finish({ status: 'succeeded' });
    await startAiCall(te.env, { ...context, userId: b.id });
    const get = async (client: Client, query = '') => (await (await client.fetch('/api/costs' + query)).json()) as CostSnapshot;
    const snapshot = await get(first);
    expect(snapshot.count).toBe(2);
    expect(snapshot.items.map(i => i.id).sort()).toEqual([one.id, two.id].sort());
    expect(snapshot.unknown).toBe(0);
    expect(snapshot.totalUsd).toBeGreaterThan(0);
    const other = await second.fetch('/api/costs');
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: 'admin_required' } });
    // Access restriction must not disable accounting for ordinary users.
    expect(await te.env.DB.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ?').bind(b.id).first('n')).toBe(1);
    await get(first);
    expect(await te.env.DB.prepare('SELECT COUNT(*) AS n FROM cost_events').first('n')).toBe(0);
    expect((await first.fetch('/api/costs?since=NaN')).status).toBe(400);
    expect((await first.fetch('/api/costs?since=-1')).status).toBe(400);
    expect((await get(first, '?since=0')).truncated).toBe(true);
    await te.env.DB.prepare('DELETE FROM terms_acceptances WHERE user_id = ?').bind(a.id).run();
    expect((await first.fetch('/api/costs')).status).toBe(403);
  });
  it('orders operations and category totals by recency, not cost, across dates', async () => {
    const te = makeEnv(), client = new Client(te), { user } = await client.login('cost-admin@example.test');
    const now = Date.now(), yesterday = now - 86400_000;
    const entries = [
      { id: 'old-expensive', feature: 'ask', time: yesterday, tokens: 100000 },
      { id: 'new-cheap', feature: 'chapter_slides', time: now - 1000, tokens: 1 },
      { id: 'middle', feature: 'ask', time: now - 60000, tokens: 100 },
    ];
    await te.env.DB.batch(entries.map(e => te.env.DB.prepare(`INSERT INTO ai_usage
      (id, operation_id, user_id, feature, provider, requested_model, response_model, status, started_at, input_tokens, output_tokens, cached_input_tokens)
      VALUES (?, ?, ?, ?, 'deepseek', 'deepseek-flash', 'deepseek-flash', 'succeeded', ?, ?, 10, 0)`)
      .bind(e.id, e.id, user.id, e.feature, e.time, e.tokens)));
    const snapshot = await (await client.fetch('/api/costs?since=' + (yesterday - 1))).json() as CostSnapshot;
    expect(snapshot.items.map(i => [i.id, i.startedAt])).toEqual([
      ['new-cheap', now - 1000], ['middle', now - 60000], ['old-expensive', yesterday],
    ]);
    expect(snapshot.groups.map(g => [g.label, g.latestStartedAt, g.count])).toEqual([
      ['章节幻灯片', now - 1000, 1], ['AI 问答', now - 60000, 2],
    ]);
    expect(snapshot.groups[0]!.usd).toBeLessThan(snapshot.groups[1]!.usd);
    expect(snapshot.totalUsd).toBeCloseTo(snapshot.groups.reduce((total, group) => total + group.usd, 0), 12);
  });
  it('caps response details without silently dropping them from the summary', async () => {
    const te = makeEnv(), client = new Client(te), { user } = await client.login('cost-admin@example.test');
    const time = Date.now();
    await te.env.DB.batch(Array.from({ length: 125 }, (_, n) => te.env.DB.prepare('INSERT INTO cost_events (id, user_id, action, status, started_at, metrics) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`event-${n}`, user.id, '保存笔记', 'succeeded', time - n, JSON.stringify({ requests: 1, d1Read: 0, d1Written: 0, r2A: 0, r2B: 0, unknown: 0 }))));
    const snapshot = await (await client.fetch('/api/costs')).json() as CostSnapshot;
    expect(snapshot.count).toBe(125); expect(snapshot.items).toHaveLength(100);
    expect(snapshot.totalUsd).toBeCloseTo(125 * .3 / 1e6, 12);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.items[0]!.id).toBe('event-0');
  });
  it('includes upload, background indexing, original storage and book filtering without private text', async () => {
    const te = makeEnv(), a = new Client(te), b = new Client(te);
    await a.login('cost-admin@example.test'); await b.login('another@example.com');
    const file = buildEpub(), form = new FormData();
    form.set('file', new File([file], 'book.epub'));
    const uploaded = await a.fetch('/api/books', { method: 'POST', body: form });
    expect(uploaded.status).toBe(202);
    const { book } = await uploaded.json() as { book: { id: string } };
    const result = await a.fetch('/api/costs?book=' + book.id);
    const snapshot = await result.json() as CostSnapshot;
    expect(snapshot.storage).toMatchObject({ books: 1, bytes: file.byteLength });
    expect(snapshot.items.some(i => i.label === '后台解析书籍')).toBe(true);
    expect(snapshot.items.some(i => i.label === '上传书籍')).toBe(true);
    expect(snapshot.items.some(i => i.label === '书籍索引向量化' && i.basis === 'estimated')).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('whales sentence');
    expect((await b.fetch('/api/costs?book=' + book.id)).status).toBe(403);
    const otherForm = new FormData(); otherForm.set('file', new File([file], 'other.epub'));
    const otherBook = await (await b.fetch('/api/books', { method: 'POST', body: otherForm })).json() as { book: { id: string } };
    expect((await a.fetch('/api/costs?book=' + otherBook.book.id)).status).toBe(404);
    const account = await (await a.fetch('/api/costs')).json() as CostSnapshot;
    expect(account.items.some(i => i.label === '上传书籍')).toBe(true);
  });
});
