import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../auth';
import type { InfraMetrics } from './costPricing';
import { observeReadRouting, primaryDatabase } from './readReplication';

const roots = new WeakMap<object, Env>();
export const unmeteredEnv = (env: Env) => roots.get(env) ?? env;

/** Request-local counters. Diagnostic failure never blocks reading or retries a paid request. */
export function createCostMeter(input: Env, requests = 0) {
  const root = unmeteredEnv(input);
  const metrics: InfraMetrics = { requests, d1Read: 0, d1Written: 0, r2A: 0, r2B: 0, unknown: 0 };
  const statements = new WeakMap<object, D1PreparedStatement>();
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  const add = (key: keyof InfraMetrics, value = 1) => { if (!closed) metrics[key] += value; };
  const track = <T>(operation: () => Promise<T>, observe: (result: T) => void) => {
    const task = (async () => { try { const result = await operation(); observe(result); return result; } catch (e) { add('unknown'); throw e; } })();
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  const observeD1 = (result: D1Result) => {
    observeReadRouting(root.DB, result.meta);
    const { rows_read: reads, rows_written: writes } = result.meta ?? {};
    if (typeof reads === 'number' && typeof writes === 'number') { add('d1Read', reads); add('d1Written', writes); }
    else add('unknown');
  };
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...values: unknown[]) => wrapStatement(target.bind(...values));
      if (key === 'all' || key === 'run') return () => track(() => target[key](), observeD1);
      // D1 first() omits billing metadata; all() returns the same first row plus meta.
      if (key === 'first') return async (column?: string) => {
        const result = await track(() => target.all<Record<string, unknown>>(), observeD1);
        const first = result.results[0];
        if (!first) return null;
        if (column !== undefined && !(column in first)) throw new Error('D1_COLUMN_NOTFOUND');
        return column === undefined ? first : first[column];
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? (...args: unknown[]) => { add('unknown'); return value.apply(target, args); } : value;
    } });
    statements.set(wrapped, statement);
    return wrapped;
  };
  const DB = new Proxy(root.DB, { get(target, key) {
    if (key === 'prepare') return (query: string) => wrapStatement(target.prepare(query));
    if (key === 'batch') return (batch: D1PreparedStatement[]) => track(() => target.batch(batch.map(s => statements.get(s) ?? s)), results => results.forEach(observeD1));
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? (...args: unknown[]) => { add('unknown'); return value.apply(target, args); } : value;
  } });
  const BOOKS = new Proxy(root.BOOKS, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => track(() => value.apply(target, args), () => {
      if (key === 'get' || key === 'head') add('r2B');
      else if (key === 'put' || key === 'list') add('r2A');
      else if (key !== 'delete') add('unknown'); // R2 delete is a free operation.
    });
  } });
  const env = new Proxy(root, { get(target, key) { return key === 'DB' ? DB : key === 'BOOKS' ? BOOKS : Reflect.get(target, key, target); } });
  roots.set(env, root);
  return { env, metrics, async finish(userId: string, bookId: string | null, action: string, startedAt: number, status: string) {
    if (closed) return;
    try {
      while (pending.size) await Promise.allSettled([...pending]);
      closed = true;
      // Never associate another user's book (or a deleted book) with this diagnostic row.
      const primary = primaryDatabase(root.DB);
      const owned = bookId ? await primary.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').bind(bookId, userId).first<{ id: string }>() : null;
      await primary.prepare('INSERT INTO cost_events (id, user_id, book_id, action, status, started_at, metrics) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), userId, owned?.id ?? null, action, status, startedAt, JSON.stringify(metrics)).run();
    } catch { closed = true; console.warn('Cost diagnostic persistence unavailable'); }
  } };
}

function actionFor(path: string, method: string) {
  if (/\/booklist$/.test(path)) return '书单请求';
  if (/\/metadata$/.test(path)) return method === 'GET' ? '读取书籍出版信息' : '补提取书籍出版信息';
  if (/\/mindmaps?(?:\/|$)/.test(path)) return '思维导图请求';
  if (path.startsWith('/api/ask')) return '问答请求';
  if (/\/notes(?:\/|$)/.test(path)) return method === 'GET' ? '读取笔记' : '保存／删除笔记';
  if (/\/annotations(?:\/|$)/.test(path)) return method === 'GET' ? '读取划线' : '保存／删除划线';
  if (/\/(?:text-atlas|atlas)(?:\/|$)/.test(path)) return '地图请求';
  if (/\/(file|cover)$/.test(path)) return '读取书籍文件／封面';
  if (/\/reindex$/.test(path)) return '重新索引请求';
  if (path === '/api/books' && method === 'POST') return '上传书籍';
  if (method === 'DELETE') return '删除书籍';
  if (method !== 'GET') return '同步阅读进度／设置';
  return '读取书架／书籍状态';
}
export const meterAccountRequest: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!/^\/api\/(books|ask)(\/|$)/.test(c.req.path)) return next();
  const root = c.env, meter = createCostMeter(root, 1), started = Date.now();
  c.env = meter.env;
  try { await next(); } finally {
    c.env = root;
    const user = c.get('user');
    if (user) c.executionCtx.waitUntil(meter.finish(user.id, c.get('costBookId') ?? /^\/api\/books\/([^/]+)/.exec(c.req.path)?.[1] ?? null, actionFor(c.req.path, c.req.method), started, c.res.status < 400 ? 'succeeded' : 'failed'));
  }
};
