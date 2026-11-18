import type { Context } from "hono";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();

const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Uniformly distributed 6-digit code (rejection sampling, no modulo bias). */
export function randomCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return String(buf[0]! % max).padStart(digits, "0");
  }
}

export function requireSecret(env: Env): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, "server_misconfigured", "SESSION_SECRET not set");
  return s;
}

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new HttpError(400, "invalid_request", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

export function safeJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export function baseUrl(c: Context): string {
  const configured = (c.env as Env).PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(c.req.url).origin;
}

/**
 * Fixed-window counter in D1. Returns false once `limit` hits within the window are exceeded.
 */
export async function rateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  const t = now();
  const windowMs = windowSec * 1000;
  const start = Math.floor(t / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, start)
    .first<{ count: number }>();
  if (Math.random() < 0.01) {
    await db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(t - 24 * 3600 * 1000).run();
  }
  const count = row?.count ?? 1;
  return { ok: count <= limit, retryAfter: Math.max(1, Math.ceil((start + windowMs - t) / 1000)) };
}

export async function enforceRateLimit(db: D1Database, key: string, limit: number, windowSec: number) {
  const r = await rateLimit(db, key, limit, windowSec);
  if (!r.ok) {
    throw new HttpError(429, "rate_limited", "Too many requests, slow down", { retryAfter: r.retryAfter });
  }
}
