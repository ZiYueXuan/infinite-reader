import { TERMS_VERSION } from '../../../shared/terms';
import { requireTermsConsent, recordTermsConsent } from '../lib/terms';
import { databaseUnavailable } from '../lib/databaseErrors';
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  type AppEnv,
  type User,
  clearSessionCookie,
  createSession,
  isSecureRequest,
  loadSession,
  signValue,
  upsertUserByEmail,
  verifySigned,
} from "../auth";
import { canViewCostDebug } from "../lib/costAccess";
import { emailLoginEnabled, getMailer, loginEmail } from "../lib/mailer";
import {
  HttpError,
  baseUrl,
  clientIp,
  enforceRateLimit,
  hmacHex,
  newId,
  now,
  parseBody,
  randomCode,
  randomToken,
  requireSecret,
  safeEqual,
  sha256Hex,
} from "../lib/util";

export const auth = new Hono<AppEnv>();

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "invalid email");

const hashCode = (env: Env, email: string, code: string) => hmacHex(requireSecret(env), `otp:${email}:${code}`);

function emailAllowed(env: Env, email: string): boolean {
  const list = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || list.includes(email);
}

auth.get("/providers", (c) =>
  c.json({
    email: emailLoginEnabled(c.env),
    google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    termsVersion: TERMS_VERSION,
  }),
);

auth.get("/me", async (c) => {
  const s = await loadSession(c);
  if (!s) throw new HttpError(401, "unauthorized", "Sign in required");
  if (!s.termsAccepted) throw new HttpError(403, "terms_required", "Please sign in again and accept the current Terms of Use.");
  return c.json({ user: sessionUser(c.env, s.user) });
});

function sessionUser(env: Env, user: User) {
  return { ...user, can_view_cost_debug: canViewCostDebug(user.email, env.COST_DEBUG_EMAILS) };
}

auth.post("/logout", async (c) => {
  const s = await loadSession(c);
  if (s) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(s.sessionId).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.post("/logout-all", async (c) => {
  const s = await loadSession(c);
  if (!s) throw new HttpError(401, "unauthorized", "Sign in required");
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(s.user.id).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// ---- Email one-time code -------------------------------------------------

auth.post("/email/request", async (c) => {
  const { email } = await parseBody(c, z.object({ email: emailSchema }));
  const db = c.env.DB;
  const mailer = getMailer(c.env);

  await enforceRateLimit(db, `otp:ip:${await sha256Hex(clientIp(c))}`, 20, 3600);
  await enforceRateLimit(db, `otp:email:${email}`, 5, 3600);

  const t = now();
  const last = await db
    .prepare("SELECT created_at FROM login_codes WHERE email = ?1 ORDER BY created_at DESC LIMIT 1")
    .bind(email)
    .first<{ created_at: number }>();
  if (last && t - last.created_at < RESEND_COOLDOWN_MS) {
    throw new HttpError(429, "cooldown", "Please wait before requesting another code", {
      retryAfter: Math.ceil((RESEND_COOLDOWN_MS - (t - last.created_at)) / 1000),
    });
  }

  // Do not reveal whether an address is allowed / registered.
  if (!emailAllowed(c.env, email)) return c.json({ ok: true, expiresInSec: CODE_TTL_MS / 1000 });

  const code = randomCode(6);
  const id = newId();
  await db
    .prepare(
      `INSERT INTO login_codes (id, email, code_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(id, email, await hashCode(c.env, email, code), t, t + CODE_TTL_MS)
    .run();

  try {
    const msg = loginEmail(c.env.APP_NAME, code, CODE_TTL_MS / 60000);
    await mailer.send({ ...msg, to: email });
  } catch (e) {
    await db.prepare("DELETE FROM login_codes WHERE id = ?1").bind(id).run();
    console.error(JSON.stringify({ message: "email send failed", error: e instanceof Error ? e.message : String(e) }));
    throw new HttpError(502, "email_send_failed", "Could not send the sign-in email");
  }
  return c.json({ ok: true, expiresInSec: CODE_TTL_MS / 1000 });
});

auth.post("/email/verify", async (c) => {
  const body = await parseBody(c, z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/), terms: z.object({ accepted: z.boolean().optional(), version: z.string().optional() }).optional() }));
  requireTermsConsent(body.terms);
  const db = c.env.DB;
  await enforceRateLimit(db, `otp-verify:ip:${await sha256Hex(clientIp(c))}`, 30, 600);
  const t = now();

  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM login_codes
       WHERE email = ?1 AND consumed_at IS NULL AND expires_at > ?2
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(body.email, t)
    .first<{ id: string; code_hash: string; attempts: number }>();
  const invalid = new HttpError(400, "invalid_code", "Invalid or expired code");
  if (!row || row.attempts >= MAX_ATTEMPTS) throw invalid;

  const ok = safeEqual(row.code_hash, await hashCode(c.env, body.email, body.code));
  if (!ok) {
    await db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?1").bind(row.id).run();
    throw invalid;
  }
  const consumed = await db
    .prepare("UPDATE login_codes SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL")
    .bind(row.id, t)
    .run();
  if (consumed.meta.changes !== 1) throw invalid;

  const userId = await upsertUserByEmail(db, body.email);
  await recordTermsConsent(c, userId, "email");
  await createSession(c, userId);
  const user = await db
    .prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?1")
    .bind(userId)
    .first<User>();
  return c.json({ user: user ? sessionUser(c.env, user) : null });
});

// ---- Google OAuth (authorization code + PKCE) -----------------------------

const OAUTH_COOKIE = "ir_oauth";

function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Older open tabs and bookmarked login links still navigate here with GET.
// A navigation is not consent: return to the current UI without creating an OAuth handshake.
auth.get("/google/start", (c) => {
  const path = safeNext(c.req.query("next")).split(/[?#]/, 1)[0]!;
  // Only reader pages are valid return targets; never redirect into another API or off-site.
  const next = path === "/" || path === "/shelf" || /^\/book\/[A-Za-z0-9_-]{1,100}$/.test(path) ? path : "/";
  return c.redirect(`${next}?auth_error=terms_required`, 303);
});

auth.post("/google/start", async (c) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, "google_not_configured", "Google login is not configured");
  }
  const body = await parseBody(c, z.object({ next: z.string().optional(), terms: z.object({ accepted: z.boolean().optional(), version: z.string().optional() }).optional() }));
  requireTermsConsent(body.terms);
  // Fail in the sign-in form before sending the reader through Google if storage is already unavailable.
  await c.env.DB.prepare('SELECT 1').first();
  const secret = requireSecret(c.env);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const next = safeNext(body.next);
  const payload = btoa(JSON.stringify({ s: state, v: verifier, n: next, t: now(), termsVersion: TERMS_VERSION }));
  setCookie(c, OAUTH_COOKIE, await signValue(secret, payload), {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${baseUrl(c)}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return c.json({ url: u.toString() });
});

auth.get("/google/callback", async (c) => {
  let returnTo: string | undefined;
  let stage: 'state' | 'token' | 'userinfo' | 'account' | 'consent' | 'session' = 'state';
  const fail = (code: string, next?: string) => {
    const path = safeNext(next);
    const joiner = path.includes("?") ? "&" : "?";
    return c.redirect(`${path}${joiner}auth_error=${encodeURIComponent(code)}`, 302);
  };
  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return fail("google_not_configured");
    if (c.req.query("error")) return fail("google_denied");

    const signed = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth/google", secure: isSecureRequest(c) });
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!signed || !code || !state) return fail("invalid_oauth_state");
    const payload = await verifySigned(requireSecret(c.env), signed);
    if (!payload) return fail("invalid_oauth_state");
    let saved: { s: string; v: string; n: string; t: number; termsVersion?: string };
    try {
      saved = JSON.parse(atob(payload));
    } catch {
      return fail("invalid_oauth_state");
    }
    returnTo = safeNext(saved.n);
    if (!safeEqual(saved.s, state) || now() - saved.t > 10 * 60 * 1000) return fail("invalid_oauth_state", saved.n);

    if (saved.termsVersion !== TERMS_VERSION) return fail("terms_updated", saved.n);

    stage = 'token';
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${baseUrl(c)}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: saved.v,
      }),
    });
    if (!tokenRes.ok) {
      console.error(JSON.stringify({ message: "google token exchange failed", status: tokenRes.status }));
      return fail("google_token_failed", saved.n);
    }
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return fail("google_token_failed", saved.n);

    // The access token was issued to us directly by Google over TLS; userinfo is the authoritative identity.
    stage = 'userinfo';
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return fail("google_userinfo_failed", saved.n);
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!info.sub || !info.email || !info.email_verified) return fail("google_email_unverified", saved.n);
    const email = info.email.toLowerCase();
    if (!emailAllowed(c.env, email)) return fail("email_not_allowed", saved.n);

    stage = 'account';
    const db = c.env.DB;
    const bySub = await db
      .prepare("SELECT id FROM users WHERE google_sub = ?1")
      .bind(info.sub)
      .first<{ id: string }>();
    let userId: string;
    if (bySub) {
      userId = bySub.id;
      await db.prepare("UPDATE users SET last_login_at = ?2 WHERE id = ?1").bind(userId, now()).run();
    } else {
      userId = await upsertUserByEmail(db, email, { name: info.name, avatar: info.picture, googleSub: info.sub });
    }
    stage = 'consent';
    await recordTermsConsent(c, userId, "google", saved.t);
    stage = 'session';
    await createSession(c, userId);
    return c.redirect(safeNext(saved.n), 302);
  } catch (error) {
    // Never return raw OAuth responses, tokens, or database details to the browser.
    // Do not retry a consumed authorization code or an ambiguous database write.
    console.error(JSON.stringify({ message: 'google sign-in failed', stage, databaseUnavailable: databaseUnavailable(error) }));
    const reason = databaseUnavailable(error) ? 'google_storage_unavailable'
      : stage === 'token' ? 'google_token_failed'
      : stage === 'userinfo' ? 'google_userinfo_failed'
      : 'google_signin_failed';
    deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth/google', secure: isSecureRequest(c) });
    return fail(reason, returnTo);
  }
});
