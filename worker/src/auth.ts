import { TERMS_VERSION } from '../../shared/terms';
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HttpError, clientIp, hmacHex, newId, now, randomToken, safeEqual, sha256Hex } from "./lib/util";

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User; sessionId: string; costBookId?: string };
};

const DAY = 24 * 3600 * 1000;

export function isSecureRequest(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export function sessionCookieName(c: Context): string {
  return isSecureRequest(c) ? "__Host-ir_session" : "ir_session";
}

function sessionTtlMs(env: Env): number {
  const d = Number(env.SESSION_TTL_DAYS);
  return (Number.isFinite(d) && d > 0 ? d : 30) * DAY;
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken(32);
  const t = now();
  const ttl = sessionTtlMs(c.env);
  const ua = c.req.header("user-agent")?.slice(0, 200) ?? null;
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?3, ?5, ?6)`,
  )
    .bind(await sha256Hex(token), userId, t, t + ttl, ua, await sha256Hex(clientIp(c)))
    .run();
  setCookie(c, sessionCookieName(c), token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(ttl / 1000),
  });
  // Opportunistic cleanup of expired sessions and login codes.
  if (Math.random() < 0.05) {
    c.executionCtx.waitUntil(
      c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(t),
        c.env.DB.prepare("DELETE FROM login_codes WHERE expires_at < ?1").bind(t - DAY),
      ]).then(() => undefined),
    );
  }
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, sessionCookieName(c), { path: "/", secure: isSecureRequest(c) });
}

export async function loadSession(c: Context<AppEnv>): Promise<{ user: User; sessionId: string; termsAccepted: boolean } | null> {
  const token = getCookie(c, sessionCookieName(c));
  if (!token) return null;
  const id = await sha256Hex(token);
  const t = now();
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sid, s.last_seen_at, s.expires_at, u.id, u.email, u.name, u.avatar_url,
       EXISTS(SELECT 1 FROM terms_acceptances ta WHERE ta.user_id = u.id AND ta.terms_version = ?2) AS terms_accepted
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1`,
  )
    .bind(id, TERMS_VERSION)
    .first<{
      terms_accepted: number;
      sid: string;
      last_seen_at: number;
      expires_at: number;
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
    }>();
  if (!row || row.expires_at < t) return null;
  if (t - row.last_seen_at > 3600 * 1000) {
    const ttl = sessionTtlMs(c.env);
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE id = ?3")
        .bind(t, t + ttl, id)
        .run()
        .then(() => undefined),
    );
  }
  return { sessionId: id, termsAccepted: !!row.terms_accepted, user: { id: row.id, email: row.email, name: row.name, avatar_url: row.avatar_url } };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = await loadSession(c);
  if (!s) throw new HttpError(401, "unauthorized", "Sign in required");
  if (!s.termsAccepted) throw new HttpError(403, "terms_required", "Please sign in again and accept the current Terms of Use.");
  c.set("user", s.user);
  c.set("sessionId", s.sessionId);
  await next();
};

/** CSRF defence in depth on top of SameSite=Lax: reject cross-origin state-changing requests. */
export const originCheck: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  const origin = c.req.header("origin");
  if (origin) {
    const allowed = new Set<string>([new URL(c.req.url).origin]);
    if (c.env.PUBLIC_BASE_URL) allowed.add(new URL(c.env.PUBLIC_BASE_URL).origin);
    for (const o of (c.env.ALLOWED_ORIGINS ?? "").split(",")) if (o.trim()) allowed.add(o.trim());
    if (!allowed.has(origin)) throw new HttpError(403, "bad_origin", "Cross-origin request rejected");
  }
  return next();
};

export async function upsertUserByEmail(
  db: D1Database,
  email: string,
  profile: { name?: string | null; avatar?: string | null; googleSub?: string | null } = {},
): Promise<string> {
  const t = now();
  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        `UPDATE users SET last_login_at = ?2,
           name = COALESCE(name, ?3), avatar_url = COALESCE(avatar_url, ?4), google_sub = COALESCE(google_sub, ?5)
         WHERE id = ?1`,
      )
      .bind(existing.id, t, profile.name ?? null, profile.avatar ?? null, profile.googleSub ?? null)
      .run();
    return existing.id;
  }
  const id = newId();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, avatar_url, google_sub, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    )
    .bind(id, email, profile.name ?? null, profile.avatar ?? null, profile.googleSub ?? null, t)
    .run();
  return id;
}

export const signValue = async (secret: string, value: string) => `${value}.${await hmacHex(secret, value)}`;

export async function verifySigned(secret: string, signed: string): Promise<string | null> {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  return safeEqual(sig, await hmacHex(secret, value)) ? value : null;
}
