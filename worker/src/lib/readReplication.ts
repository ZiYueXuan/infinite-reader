import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../auth';

type Routing = { primary: D1Database; primaryReads: number; replicaReads: number; regions: Set<string> };
const sessions = new WeakMap<D1Database, Routing>();

/** Only ordinary reader GETs. Job admission/polling, auth callbacks and writes stay primary. */
export function replicaEligible(method: string, path: string): boolean {
  return method === 'GET' && /^\/api\/books(?:\/[^/]+(?:\/(?:annotations|notes|file|cover))?)?\/?$/.test(path);
}

export function primaryDatabase(db: D1Database): D1Database {
  return sessions.get(db)?.primary ?? db;
}

export function observeReadRouting(db: D1Database, meta: D1Meta): void {
  const routing = sessions.get(db);
  if (!routing || meta.rows_written > 0) return;
  if (meta.served_by_primary === true) routing.primaryReads++;
  if (meta.served_by_primary === false) routing.replicaReads++;
  if (typeof meta.served_by_region === 'string') routing.regions.add(meta.served_by_region);
}

export const readReplication: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!replicaEligible(c.req.method, c.req.path)) return next();
  const root = c.env;
  // The first query is loadSession's authoritative login/consent check. Its bookmark
  // fences subsequent reads at least as fresh as that check, including prior writes
  // from other tabs/devices. No browser bookmark or eventually-consistent auth needed.
  const session = root.DB.withSession('first-primary');
  const db = new Proxy(root.DB, { get(target, key) {
    if (key === 'prepare') return session.prepare.bind(session);
    if (key === 'batch') return session.batch.bind(session);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const routing: Routing = { primary: root.DB, primaryReads: 0, replicaReads: 0, regions: new Set() };
  sessions.set(db, routing);
  c.env = new Proxy(root, { get(target, key) { return key === 'DB' ? db : Reflect.get(target, key, target); } });
  try { await next(); } finally {
    c.env = root;
    if (routing.primaryReads + routing.replicaReads > 0) console.log(JSON.stringify({
      message: 'd1_read_routing', primaryReads: routing.primaryReads, replicaReads: routing.replicaReads,
      regions: [...routing.regions],
    }));
  }
};
