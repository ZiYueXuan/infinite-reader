import { beforeEach, describe, expect, it } from 'vitest';
import { replicaEligible } from '../src/lib/readReplication';
import { Client, makeEnv, resetDb } from './helpers';

beforeEach(resetDb);

describe('reader replica sessions', () => {
  it('keeps mutations, auth callbacks, AI jobs and polling on the primary', () => {
    for (const path of ['/api/books', '/api/books/b', '/api/books/b/notes', '/api/books/b/annotations', '/api/books/b/file', '/api/books/b/cover']) {
      expect(replicaEligible('GET', path)).toBe(true);
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD']) expect(replicaEligible(method, path)).toBe(false);
    }
    for (const path of ['/api/auth/google/callback', '/api/ask/stream', '/api/costs', '/api/books/b/slides', '/api/books/b/status', '/api/books/b/chat', '/api/books/b/atlas', '/api/books/b/booklist', '/api/books/b/mindmaps']) expect(replicaEligible('GET', path)).toBe(false);
  });

  it('starts each request with primary auth, isolates its session, and honors revoked logins', async () => {
    const te = makeEnv();
    const primary = te.env.DB;
    const calls: { constraint: string | undefined; queries: string[] }[] = [];
    te.env.DB = new Proxy(primary, { get(target, key) {
      if (key === 'withSession') return (constraint?: string) => {
        const call = { constraint, queries: [] as string[] };
        calls.push(call);
        const session = target.withSession(constraint);
        return new Proxy(session, { get(target, key) {
          if (key === 'prepare') return (sql: string) => { call.queries.push(sql); return target.prepare(sql); };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const client = new Client(te);
    expect((await client.fetch('/api/books')).status).toBe(401);
    expect(calls[0].queries).toEqual([]); // Anonymous shelf never needs D1.
    await client.login();
    expect((await client.fetch('/api/books')).status).toBe(200);
    expect((await client.fetch('/api/books')).status).toBe(200);
    expect(calls).toHaveLength(3);
    for (const call of calls.slice(1)) {
      expect(call.constraint).toBe('first-primary');
      expect(call.queries[0]).toContain('FROM sessions');
      expect(call.queries[1]).toContain('FROM books');
      expect(call.queries.some(q => q.includes('cost_events'))).toBe(false);
    }
    // Simulate another device/server revoking the token; no client bookmark/cookie changes.
    await primary.prepare('DELETE FROM sessions').run();
    expect((await client.fetch('/api/books')).status).toBe(401);
    expect(calls.at(-1)!.queries).toHaveLength(1);
  });
});
