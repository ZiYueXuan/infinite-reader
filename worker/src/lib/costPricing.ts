import type { CostItem, CostPart } from '../../../shared/costs';
export const PRICING_VERSION = '2026-10-29 / DeepSeek Search 2026-11-14';
const SEARCH_PRICING_VERSION = '2026-11-12';
const DEEPSEEK_SEARCH_PRICING_VERSION = '2026-11-14';
const DEEPSEEK_SEARCH_USD_PER_REQUEST = .75 / 1000;
const CERAMIC_USD_PER_REQUEST = .25 / 1000;
const CREDIT_PURCHASE_FEE = .05;
export const SOURCES = [
  { label: 'DeepSeek Search', url: 'https://api-docs.deepseek.com/guides/search/' },
  { label: 'Cloudflare Web Search', url: 'https://developers.cloudflare.com/web-search/providers/' },
  { label: 'AI Gateway Unified Billing', url: 'https://developers.cloudflare.com/ai-gateway/features/unified-billing/' },
  { label: 'DeepSeek', url: 'https://api-docs.deepseek.com/quick_start/pricing/' },
  { label: 'Workers AI', url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' },
  { label: 'BGE-M3', url: 'https://developers.cloudflare.com/workers-ai/models/bge-m3/' },
  { label: 'GLM-5.3 Flash', url: 'https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/' },
  { label: 'Workers', url: 'https://developers.cloudflare.com/workers/platform/pricing/' },
  { label: 'D1', url: 'https://developers.cloudflare.com/d1/platform/pricing/' },
  { label: 'R2', url: 'https://developers.cloudflare.com/r2/pricing/' },
];
export const FEATURE_LABELS: Record<string, string> = { text_atlas: '阅读地图', web_search: '外部搜索', chapter_slides: '章节幻灯片', booklist: '提取书单', mindmap: '章节思维导图', highlight_mindmap: '划线思维导图', ask: 'AI 问答', index_embedding: '书籍索引向量化', retrieval_embedding: '检索向量化', atlas_primary: '地图识别', atlas_fallback: '地图识别 · 备用模型' };
export interface UsageRow {
  id: string; operation_id: string; book_id: string | null; book_title?: string | null; feature: string; provider: string
  requested_model: string; response_model: string | null; status: string; started_at: number
  input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null
  input_characters: number | null; raw_usage: string | null
  http_status?: number | null; provider_request_id?: string | null; error_code?: string | null
}
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function priceAi(r: UsageRow): CostItem {
  const item: CostItem = { id: r.id, operationId: r.operation_id, category: r.feature, label: FEATURE_LABELS[r.feature] ?? r.feature,
    bookId: r.book_id, bookTitle: r.book_title ?? null, startedAt: r.started_at, status: r.status, model: r.response_model ?? r.requested_model,
    usd: null, lowUsd: null, basis: 'unavailable', reason: '用量或模型单价不可用；不按零计费', parts: [],
    tokens: { input: r.input_tokens, output: r.output_tokens, cached: r.cached_input_tokens } };
  let raw: { neurons?: number; search_requests?: number; search_attempts?: number; search_billable_requests?: number } = {};
  try { raw = JSON.parse(r.raw_usage ?? '{}') ?? {}; } catch { /* unknown */ }
  if (r.feature === 'web_search') {
    if (r.provider === 'deepseek' && r.requested_model === 'deepseek-search') {
      const billed = raw.search_billable_requests === 0 || raw.search_billable_requests === 1 ? raw.search_billable_requests : null;
      const requests = raw.search_requests === 0 || raw.search_requests === 1 ? raw.search_requests : null;
      item.search = { requests, billedRequests: billed, attempts: raw.search_attempts === 1 ? 1 : null,
        httpStatus: r.http_status ?? null, providerRequestId: r.provider_request_id ?? null,
        errorCode: r.error_code ?? null, pricingVersion: DEEPSEEK_SEARCH_PRICING_VERSION };
      if (r.status === 'started') { item.reason = '调用进行中或用量尚未落库'; return item; }
      const receivedSuccess = r.http_status === 200 && requests === 1;
      const receivedFailure = r.http_status != null && r.http_status >= 300 && requests === 0;
      if (billed === null || !(receivedSuccess || (receivedFailure && billed === 0))) {
        item.reason = '未确认 DeepSeek 搜索计费用量；超时、取消或异常响应需核对账单，不按零计费';
        return item;
      }
      const usd = billed * DEEPSEEK_SEARCH_USD_PER_REQUEST;
      item.parts = [{ label: 'DeepSeek 搜索', quantity: billed, unit: '次 × $0.75 / 千次', usd }];
      item.usd = item.lowUsd = usd; item.basis = 'estimated';
      item.reason = '按 DeepSeek 返回状态及结果推算计费次数 × 公开单价；空结果和供应商明确失败不计费，本地超时仍待核对；不含问答 token，未完成账单对账';
      return item;
    }
    // One ledger row owns one attempt. A successful response is an application
    // counter, not a provider invoice; do not turn failures or missing counts into $0.
    const requests = raw.search_requests === 1 ? 1 : null;
    item.search = { requests, attempts: raw.search_attempts === 1 || requests === 1 ? 1 : null,
      httpStatus: r.http_status ?? null, providerRequestId: r.provider_request_id ?? null,
      errorCode: r.error_code ?? null, pricingVersion: SEARCH_PRICING_VERSION };
    if (r.status === 'started') { item.reason = '调用进行中或用量尚未落库'; return item; }
    if (r.provider !== 'cloudflare' || r.requested_model !== 'ceramic') return item;
    if (requests === null || (r.http_status != null && (r.http_status < 200 || r.http_status >= 300))) { item.reason = '未确认成功搜索次数；失败、超时或取消仍可能扣费，待供应商账单核对，不按零计费'; return item; }
    const base = requests * CERAMIC_USD_PER_REQUEST, fee = base * CREDIT_PURCHASE_FEE;
    item.parts = [
      { label: 'Ceramic 搜索', quantity: requests, unit: '次 × $0.25 / 千次', usd: base },
      { label: '额度购入手续费分摊（5%）', quantity: requests, unit: '次 × $0.0000125', usd: fee },
    ];
    item.usd = item.lowUsd = base + fee;
    item.basis = 'estimated';
    item.reason = '应用记录的成功搜索次数 × 公开单价，含付费额度购入手续费分摊；不是供应商确认扣款，未完成账单对账';
    return item;
  }
  if (r.status === 'started') { item.reason = '调用进行中或用量尚未落库'; return item; }
  if (r.provider === 'cloudflare' && valid(raw.neurons)) {
    item.usd = item.lowUsd = raw.neurons * .011 / 1000;
    item.parts = [{ label: 'Workers AI neurons', quantity: raw.neurons, unit: 'neurons × $0.011 / 千', usd: item.usd }];
    item.basis = 'reported'; item.reason = '供应商返回 neurons × 公开单价（不再叠加 token 费用）'; return item;
  }
  const model = item.model!.toLowerCase();
  if (r.provider === 'cloudflare' && model === '@cf/baai/bge-m3') {
    const input = valid(r.input_tokens) ? r.input_tokens : valid(r.input_characters) ? Math.ceil(r.input_characters / 2) : null;
    if (input === null) return item;
    item.usd = item.lowUsd = input * .0118 / 1e6;
    item.basis = valid(r.input_tokens) ? 'reported' : 'estimated';
    item.reason = item.basis === 'reported' ? '供应商返回输入 token × 单价' : '供应商未返回 token；暂按字符数 ÷ 2 粗估，非 tokenizer 计数';
    item.parts = [{ label: '输入', quantity: input, unit: 'tokens × $0.0118 / 百万', usd: item.usd }]; return item;
  }
  if (!valid(r.input_tokens) || !valid(r.output_tokens)) return item;
  let inputRate: number, cacheRate: number, outputRate: number, lowFactor = 1;
  if (r.provider === 'cloudflare' && model === '@cf/zai-org/glm-5.3-flash') {
    inputRate = .15; cacheRate = .03; outputRate = .50;
  } else if (r.provider === 'deepseek') {
    // Do not guess pricing from old chat/reasoner aliases when the response model is absent.
    if (['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash-1017'].includes(model)) {
      inputRate = .30; cacheRate = .006; outputRate = 1.20;
    } else if (['deepseek-v4-pro', 'deepseek-v4-pro-0813'].includes(model)) {
      inputRate = 1.32; cacheRate = .044; outputRate = 3.96;
    } else return item;
    const date = new Date(r.started_at), day = date.getUTCDay(), hour = date.getUTCHours();
    const peakWindow = day > 0 && day < 6 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
    if (!peakWindow) { inputRate /= 2; cacheRate /= 2; outputRate /= 2; }
    else lowFactor = .5; // Chinese public holidays use off-peak pricing; no holiday calendar is assumed.
  } else return item;
  if (valid(r.cached_input_tokens) && r.cached_input_tokens > r.input_tokens) { item.reason = '缓存 token 大于输入 token，无法可靠估算'; return item; }
  const cached = r.cached_input_tokens ?? 0, miss = r.input_tokens - cached;
  const part = (label: string, quantity: number, rate: number): CostPart => ({ label, quantity, unit: `tokens × $${rate} / 百万`, usd: quantity * rate / 1e6 });
  item.parts = [part('未缓存输入', miss, inputRate), part('缓存输入', cached, cacheRate), part('输出（已含推理 token）', r.output_tokens, outputRate)];
  item.usd = item.parts.reduce((sum, p) => sum + p.usd, 0);
  item.lowUsd = (valid(r.cached_input_tokens) ? item.usd : (r.input_tokens * cacheRate + r.output_tokens * outputRate) / 1e6) * lowFactor;
  item.basis = lowFactor < 1 || !valid(r.cached_input_tokens) ? 'estimated' : 'reported';
  item.reason = [ 'token 用量 × 当前公开单价', !valid(r.cached_input_tokens) ? '缓存拆分缺失：展示全命中至全未命中的区间' : '', lowFactor < 1 ? '峰时窗口：中国节假日未核对，展示半价至峰价区间' : '' ].filter(Boolean).join('；');
  return item;
}

export interface InfraMetrics { requests: number; d1Read: number; d1Written: number; r2A: number; r2B: number; unknown: number }
export function priceInfra(metrics: InfraMetrics): CostPart[] {
  return [
    { label: 'Worker 请求', quantity: metrics.requests, rate: .30 },
    { label: 'D1 读取行', quantity: metrics.d1Read, rate: .001 },
    { label: 'D1 写入行', quantity: metrics.d1Written, rate: 1 },
    { label: 'R2 Class A', quantity: metrics.r2A, rate: 4.5 },
    { label: 'R2 Class B', quantity: metrics.r2B, rate: .36 },
  ].filter(p => p.quantity > 0).map(p => ({ label: p.label, quantity: p.quantity, unit: `单位 × $${p.rate} / 百万`, usd: p.quantity * p.rate / 1e6 }));
}
