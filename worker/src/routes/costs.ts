import { Hono } from 'hono';
import { type AppEnv, requireAuth } from '../auth';
import { canViewCostDebug } from '../lib/costAccess';
import { HttpError } from '../lib/util';
import { priceAi, priceInfra, PRICING_VERSION, SOURCES, type UsageRow, type InfraMetrics } from '../lib/costPricing';
import type { CostItem, CostSnapshot } from '../../../shared/costs';

export const costs = new Hono<AppEnv>();
costs.use('*', requireAuth);
costs.use('*', async (c, next) => {
  if (!canViewCostDebug(c.get('user').email, c.env.COST_DEBUG_EMAILS)) {
    throw new HttpError(403, 'admin_required', 'Administrator access required');
  }
  await next();
});
const LIMIT = 2000;
costs.get('/', async c => {
  const user = c.get('user'), asOf = Date.now();
  const requested = Number(c.req.query('since') ?? asOf - 86400_000);
  if (!Number.isSafeInteger(requested) || requested < 0 || requested > asOf + 60_000) throw new HttpError(400, 'invalid_since', 'Invalid observation start time');
  const since = Math.max(requested, asOf - 31 * 86400_000);
  const feature = c.req.query('feature');
  if (feature !== undefined && feature !== 'web_search') throw new HttpError(400, 'invalid_feature', 'Invalid cost type');
  const book = c.req.query('book');
  if (book && !await c.env.DB.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').bind(book, user.id).first()) throw new HttpError(404, 'not_found', 'Book not found');
  const scope = (book ? ' AND u.book_id = ?' : '') + (feature ? " AND u.feature = 'web_search'" : '');
  const bindings = book ? [user.id, since, asOf, book] : [user.id, since, asOf];
  const [ai, infra, storage] = await Promise.all([
    c.env.DB.prepare(`SELECT u.*, b.title AS book_title FROM ai_usage u LEFT JOIN books b ON b.id = u.book_id AND b.user_id = u.user_id WHERE u.user_id = ? AND u.started_at >= ? AND u.started_at <= ?${scope} ORDER BY u.started_at DESC, u.id DESC LIMIT ${LIMIT + 1}`).bind(...bindings).all<UsageRow>(),
    feature ? Promise.resolve({ results: [] }) : c.env.DB.prepare(`SELECT u.*, b.title AS book_title FROM cost_events u LEFT JOIN books b ON b.id = u.book_id AND b.user_id = u.user_id WHERE u.user_id = ? AND u.started_at >= ? AND u.started_at <= ?${scope} ORDER BY u.started_at DESC, u.id DESC LIMIT ${LIMIT + 1}`).bind(...bindings).all<{ id: string; book_id: string | null; book_title: string | null; action: string; status: string; started_at: number; metrics: string }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS books, COALESCE(SUM(size_bytes), 0) AS bytes FROM books WHERE user_id = ?${book ? ' AND id = ?' : ''}`).bind(...(book ? [user.id, book] : [user.id])).first<{ books: number; bytes: number }>(),
  ]);
  const items = ai.results.slice(0, LIMIT).map(priceAi);
  for (const row of infra.results.slice(0, LIMIT)) {
    const metrics = JSON.parse(row.metrics) as InfraMetrics, parts = priceInfra(metrics);
    const usd = parts.reduce((sum, part) => sum + part.usd, 0);
    items.push({ id: row.id, operationId: row.id, category: 'infrastructure', label: row.action, bookId: row.book_id, bookTitle: row.book_title, startedAt: row.started_at, status: row.status, model: null,
      usd, lowUsd: usd, basis: metrics.unknown ? 'unavailable' : 'reported', reason: metrics.unknown ? `部分操作未返回计量，仅展示已知部分（${metrics.unknown} 项缺失）` : 'D1 返回的行数 / R2 成功操作次数 × 单价；不含 CPU 和后台 Agent', parts });
  }
  items.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
  const groups = new Map<string, CostSnapshot['groups'][number]>();
  for (const item of items) {
    const label = item.category === 'infrastructure' ? '数据库 / 文件 / 请求' : item.label;
    const group = groups.get(label) ?? { label, usd: 0, count: 0, unknown: 0, latestStartedAt: item.startedAt };
    group.latestStartedAt = Math.max(group.latestStartedAt, item.startedAt);
    group.usd += item.usd ?? 0; group.count++; if (item.basis === 'unavailable') group.unknown++;
    groups.set(label, group);
  }
  const snapshot: CostSnapshot = {
    ...(feature ? { feature } : {}),
    since, asOf, pricingVersion: PRICING_VERSION, currency: 'USD', truncated: requested !== since || ai.results.length > LIMIT || infra.results.length > LIMIT,
    totalUsd: items.reduce((n, i) => n + (i.usd ?? 0), 0), lowUsd: items.reduce((n, i) => n + (i.lowUsd ?? 0), 0),
    unknown: items.filter(i => i.basis === 'unavailable').length, estimated: items.filter(i => i.basis === 'estimated').length, count: items.length,
    groups: [...groups.values()].sort((a, b) => b.latestStartedAt - a.latestStartedAt || a.label.localeCompare(b.label)), items: items.slice(0, 100),
    storage: { bytes: storage?.bytes ?? 0, books: storage?.books ?? 0, usdPerMonth: (storage?.bytes ?? 0) / 1e9 * .015 },
    sources: SOURCES,
    exclusions: [
      'DeepSeek 搜索按非空成功结果计费，由 DeepSeek 余额扣除；明确失败和空结果不计费，本地超时或取消后未确认的用量仍需核对。问答 token 单独计量。',
      '按当前公开单价估算的已知费用小计，不是供应商账单；未扣免费额度、优惠、税费，也未应用账单取整。',
      'Ceramic 按成功搜索次数估算，另计付费额度购入时 5% 手续费的分摊；不重复计入充值本金。未确认用量的异常调用需在 Cloudflare 核对，赠送额度及实际扣款未自动对账。',
      '未计量：Workers CPU、Durable Objects（含 Agent 内部数据库操作）、Vectorize、Queues、邮件、日志，以及 D1/封面/识图缓存存储。',
      '原书存储仅为当前文件大小保持一个月的推算，单列展示，不加入操作小计；不代表历史 GB-month 用量。',
      '调试窗口轮询、计量表自身读写和登录请求未计入；收起窗口或切换到后台会暂停自动刷新。',
      'DeepSeek 峰时遇中国节假日可能按低价计费；缺少缓存拆分时显示范围，未知模型不猜测单价。',
      '旧向量化记录没有 token / 字符数据时无法回算；失败或中断调用若缺少用量也不按零费用处理。',
    ],
  };
  return c.json(snapshot);
});
