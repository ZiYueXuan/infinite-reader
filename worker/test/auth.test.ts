import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, costDebugEmail, makeEnv, mockFetch, resetDb, termsConsent } from "./helpers";

beforeEach(resetDb);
let restore: (() => void) | undefined;
afterEach(() => restore?.());

describe("email one-time code", () => {
  it("returns the signed-in user's capability without exposing the allowlist", async () => {
    const otherAdmin = "other-admin@example.test";
    const c = new Client(makeEnv({ COST_DEBUG_EMAILS: `${costDebugEmail},${otherAdmin}` }));
    const { user } = await c.login(costDebugEmail);
    expect(user).toMatchObject({ can_view_cost_debug: true });
    const response = await c.fetch("/api/auth/me");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ user: { can_view_cost_debug: true } });
    expect(body).not.toContain(otherAdmin);
  });

  it("emails a code, stores only a hash, and logs in", async () => {
    const te = makeEnv();
    const c = new Client(te);
    const r = await c.fetch("/api/auth/email/request", { method: "POST", json: { email: "A@Example.com " } });
    expect(r.status).toBe(200);
    expect(te.sent).toHaveLength(1);
    expect(te.sent[0]!.to).toBe("a@example.com");
    const code = te.sent[0]!.text.match(/\b(\d{6})\b/)![1]!;

    const row = await env.DB.prepare("SELECT code_hash FROM login_codes").first<{ code_hash: string }>();
    expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.code_hash).not.toContain(code);

    expect((await c.fetch("/api/auth/me")).status).toBe(401);
    const v = await c.fetch("/api/auth/email/verify", { method: "POST", json: { email: "a@example.com", code, terms: termsConsent } });
    expect(v.status).toBe(200);
    const setCookie = v.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/__Host-ir_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const me = await c.fetch("/api/auth/me");
    expect(((await me.json()) as any).user.email).toBe("a@example.com");

    // sessions are stored hashed
    const s = await env.DB.prepare("SELECT id FROM sessions").first<{ id: string }>();
    expect(c.cookie).not.toContain(s!.id);

    // a code is single-use
    const again = await new Client(te).fetch("/api/auth/email/verify", { method: "POST", json: { email: "a@example.com", code, terms: termsConsent } });
    expect(again.status).toBe(400);

    await c.fetch("/api/auth/logout", { method: "POST" });
    expect((await c.fetch("/api/auth/me")).status).toBe(401);
  });

  it("locks a code after 5 wrong attempts", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.fetch("/api/auth/email/request", { method: "POST", json: { email: "b@example.com" } });
    const code = te.sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await c.fetch("/api/auth/email/verify", { method: "POST", json: { email: "b@example.com", code: wrong, terms: termsConsent } });
      expect(r.status).toBe(400);
    }
    const r = await c.fetch("/api/auth/email/verify", { method: "POST", json: { email: "b@example.com", code, terms: termsConsent } });
    expect(r.status).toBe(400);
  });

  it("enforces resend cooldown and hourly limits", async () => {
    const te = makeEnv();
    const c = new Client(te);
    expect((await c.fetch("/api/auth/email/request", { method: "POST", json: { email: "c@example.com" } })).status).toBe(200);
    const second = await c.fetch("/api/auth/email/request", { method: "POST", json: { email: "c@example.com" } });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    expect(te.sent).toHaveLength(1);
  });

  it("rejects malformed input and expired codes", async () => {
    const te = makeEnv();
    const c = new Client(te);
    expect((await c.fetch("/api/auth/email/request", { method: "POST", json: { email: "nope" } })).status).toBe(400);
    await c.fetch("/api/auth/email/request", { method: "POST", json: { email: "d@example.com" } });
    const code = te.sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    await env.DB.prepare("UPDATE login_codes SET expires_at = ?1").bind(Date.now() - 1000).run();
    const r = await c.fetch("/api/auth/email/verify", { method: "POST", json: { email: "d@example.com", code, terms: termsConsent } });
    expect(r.status).toBe(400);
  });

  it("returns 503 (no silent fallback) when email is not configured", async () => {
    const te = makeEnv({ EMAIL_PROVIDER: "none" });
    const r = await new Client(te).fetch("/api/auth/email/request", { method: "POST", json: { email: "e@example.com" } });
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).error.code).toBe("email_not_configured");
    const p = await new Client(te).fetch("/api/auth/providers");
    expect(((await p.json()) as any).email).toBe(false);
  });

  it("honours the ALLOWED_EMAILS allowlist without revealing it", async () => {
    const te = makeEnv({ ALLOWED_EMAILS: "ok@example.com" });
    const r = await new Client(te).fetch("/api/auth/email/request", { method: "POST", json: { email: "no@example.com" } });
    expect(r.status).toBe(200);
    expect(te.sent).toHaveLength(0);
  });

  it("rejects cross-origin state-changing requests", async () => {
    const te = makeEnv();
    const r = await new Client(te).fetch("/api/auth/email/request", {
      method: "POST",
      json: { email: "f@example.com" },
      headers: { origin: "https://evil.example" },
    });
    expect(r.status).toBe(403);
  });
});

describe("google oauth", () => {
  it.each(['account', 'consent', 'session'] as const)("returns to sign-in when D1 fails during %s, without issuing a session", async (stage) => {
    const match = { account: 'SELECT id FROM users WHERE google_sub', consent: 'INSERT INTO terms_acceptances', session: 'INSERT INTO sessions' }[stage];
    const DB = new Proxy(env.DB, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (sql.includes(match)) throw new Error('D1_ERROR: internal error; reference = private-database-reference');
        return target.prepare(sql);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const c = new Client(makeEnv({ DB })), next = '/book/keep-this-book';
    const start = await c.fetch('/api/auth/google/start', { method: 'POST', json: { next, terms: termsConsent } });
    const state = new URL(((await start.json()) as any).url).searchParams.get('state');
    const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
    restore = mockFetch({
      'https://oauth2.googleapis.com/token': () => Response.json({ access_token: 'private-token' }),
      'https://openidconnect.googleapis.com/v1/userinfo': () => Response.json({ sub: 'google-outage', email: 'outage@example.com', email_verified: true }),
    }).restore;
    const response = await c.fetch(`/api/auth/google/callback?state=${state}&code=private-code`, { headers: { cookie } });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(next + '?auth_error=google_storage_unavailable');
    expect(response.headers.get('set-cookie')).not.toContain('__Host-ir_session');
    expect(response.headers.get('set-cookie')).toContain('ir_oauth=');
    expect(await env.DB.prepare('SELECT id FROM sessions').first()).toBeNull();
    expect(await response.text()).not.toContain('private-');
  });

  it.each(['token', 'userinfo'] as const)('handles thrown and malformed Google %s responses without a raw 500', async (stage) => {
    for (const malformed of [false, true]) {
      const c = new Client(makeEnv());
      const start = await c.fetch('/api/auth/google/start', { method: 'POST', json: { next: '/book/return', terms: termsConsent } });
      const state = new URL(((await start.json()) as any).url).searchParams.get('state');
      const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
      const failure = () => { if (malformed) return new Response('invalid json'); throw new Error('upstream connection lost'); };
      const mock = mockFetch({
        'https://oauth2.googleapis.com/token': stage === 'token' ? failure : () => Response.json({ access_token: 'private-token' }),
        'https://openidconnect.googleapis.com/v1/userinfo': failure,
      });
      try {
        const response = await c.fetch(`/api/auth/google/callback?state=${state}&code=code`, { headers: { cookie } });
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe(`/book/return?auth_error=google_${stage}_failed`);
        expect(await env.DB.prepare('SELECT id FROM sessions').first()).toBeNull();
      } finally { mock.restore(); }
    }
  });

  it('reports unavailable account storage as 503 rather than an invalid session', async () => {
    const c = new Client(makeEnv({ DB: { prepare() { throw new Error('D1_ERROR: internal error; reference = private-reference'); } } }));
    const response = await c.fetch('/api/auth/me', { headers: { cookie: '__Host-ir_session=not-a-real-session' } });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ error: { code: 'database_unavailable', message: 'Account storage is temporarily unavailable. Please try again shortly.' } });
  });

  it('checks storage before creating an OAuth handshake', async () => {
    const c = new Client(makeEnv({ DB: { prepare() { throw new Error('D1_ERROR: internal error'); } } }));
    const response = await c.fetch('/api/auth/google/start', { method: 'POST', json: { terms: termsConsent } });
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await response.json() as any).error.code).toBe('database_unavailable');
  });

  it("recovers old Google GET links into explicit consent without starting OAuth", async () => {
    const c = new Client(makeEnv());
    const book = "/book/11111111-1111-4111-8111-111111111111";
    for (const [next, expected] of [
      ["/", "/"], [book, book], [book + "?auth_error=old#page", book],
      ["https://evil.example", "/"], ["//evil.example", "/"],
      ["/api/auth/google/start", "/"], ["/book/../api/auth/google/start", "/"],
      ["/\\evil.example", "/"], ["/%2fevil.example", "/"],
    ]) {
      const response = await c.fetch('/api/auth/google/start?next=' + encodeURIComponent(next!));
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(expected + '?auth_error=terms_required');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect((await c.fetch('/api/auth/google/start')).headers.get('location')).toBe('/?auth_error=terms_required');
    expect(await env.DB.prepare('SELECT id FROM sessions').first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM terms_acceptances').first()).toBeNull();
  });

  it("redirects to Google with PKCE and completes the callback", async () => {
    const te = makeEnv();
    const c = new Client(te);
    const start = await c.fetch("/api/auth/google/start", { method: "POST", json: { next: "/library", terms: termsConsent } });
    expect(start.status).toBe(200);
    const loc = new URL(((await start.json()) as { url: string }).url);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://reader.test/api/auth/google/callback");
    const state = loc.searchParams.get("state")!;
    const oauthCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    expect(start.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const m = mockFetch({
      "https://oauth2.googleapis.com/token": async (req) => {
        const body = new URLSearchParams(await req.text());
        expect(body.get("code")).toBe("abc");
        expect(body.get("code_verifier")).toBeTruthy();
        return Response.json({ access_token: "tok" });
      },
      "https://openidconnect.googleapis.com/v1/userinfo": () =>
        Response.json({ sub: "g-123", email: "G@Example.com", email_verified: true, name: "G User", picture: "https://x/p.png" }),
    });
    restore = m.restore;

    c.cookie = "";
    const cb = await c.fetch(`/api/auth/google/callback?code=abc&state=${state}`, { headers: { cookie: oauthCookie } });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/library");
    const me = await c.fetch("/api/auth/me");
    const user = ((await me.json()) as any).user;
    expect(user.email).toBe("g@example.com");
    expect(user.name).toBe("G User");
    const consent = await env.DB.prepare("SELECT * FROM terms_acceptances WHERE user_id = ?1").bind(user.id).first<any>();
    expect(consent.terms_version).toBe(termsConsent.version);
    expect(consent.method).toBe('google');
    expect(consent.recorded_at).toBeGreaterThanOrEqual(consent.accepted_at);
  });

  it("sends a book deep link through Google and back", async () => {
    const te = makeEnv();
    const c = new Client(te);
    const next = "/book/11111111-1111-4111-8111-111111111111";
    const start = await c.fetch("/api/auth/google/start", { method: "POST", json: { next, terms: termsConsent } });
    const loc = new URL(((await start.json()) as { url: string }).url);
    const state = loc.searchParams.get("state")!;
    const oauthCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const m = mockFetch({
      "https://oauth2.googleapis.com/token": () => Response.json({ access_token: "tok" }),
      "https://openidconnect.googleapis.com/v1/userinfo": () =>
        Response.json({ sub: "g-book", email: "reader@example.com", email_verified: true, name: "Reader" }),
    });
    restore = m.restore;
    c.cookie = "";
    const cb = await c.fetch(`/api/auth/google/callback?code=abc&state=${state}`, { headers: { cookie: oauthCookie } });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(next);
  });

  it("keeps a book deep link when Google sign-in fails", async () => {
    const te = makeEnv();
    const c = new Client(te);
    const next = "/book/22222222-2222-4222-8222-222222222222";
    const start = await c.fetch("/api/auth/google/start", { method: "POST", json: { next, terms: termsConsent } });
    const oauthCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const cb = await c.fetch("/api/auth/google/callback?code=abc&state=wrong", { headers: { cookie: oauthCookie } });
    const loc = cb.headers.get("location")!;
    expect(loc.startsWith(next + "?")).toBe(true);
    expect(loc).toContain("auth_error=invalid_oauth_state");
    expect((await c.fetch("/api/auth/me")).status).toBe(401);
  });

  it("rejects a callback with a bad state", async () => {
    const te = makeEnv();
    const c = new Client(te);
    const start = await c.fetch("/api/auth/google/start", { method: "POST", json: { terms: termsConsent } });
    const oauthCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const cb = await c.fetch("/api/auth/google/callback?code=abc&state=wrong", { headers: { cookie: oauthCookie } });
    expect(cb.headers.get("location")).toContain("auth_error=invalid_oauth_state");
    expect((await c.fetch("/api/auth/me")).status).toBe(401);
  });

  it("is reported as unavailable without credentials", async () => {
    const te = makeEnv({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" });
    const c = new Client(te);
    expect((await c.fetch("/api/auth/google/start", { method: "POST", json: { terms: termsConsent } })).status).toBe(503);
  });
});

describe('mandatory Terms of Use consent', () => {
  it('rejects missing, false and stale email consent without consuming the code or creating a session', async () => {
    const te = makeEnv(), c = new Client(te), email = 'consent@example.com';
    await c.fetch('/api/auth/email/request', { method: 'POST', json: { email } });
    const code = te.sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    for (const terms of [undefined, { ...termsConsent, accepted: false }, { accepted: true, version: 'old' }]) {
      const response = await c.fetch('/api/auth/email/verify', { method: 'POST', json: { email, code, terms } });
      expect(response.status).toBe(403);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(await env.DB.prepare('SELECT id FROM sessions').first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM terms_acceptances').first()).toBeNull();
    const verified = await c.fetch('/api/auth/email/verify', { method: 'POST', json: { email, code, terms: termsConsent } });
    expect(verified.status).toBe(200);
    const user = ((await verified.json()) as any).user;
    const consent = await env.DB.prepare('SELECT * FROM terms_acceptances').first<any>();
    expect(consent.user_id).toBe(user.id);
    expect(consent.terms_version).toBe(termsConsent.version);
    expect(consent.method).toBe('email');
    expect(consent.accepted_at).toBeGreaterThan(0);
    expect(consent.recorded_at).toBeGreaterThanOrEqual(consent.accepted_at);
    expect((await c.fetch('/api/books')).status).toBe(200);
  });

  it('does not record consent for failed identity verification', async () => {
    const te = makeEnv(), c = new Client(te);
    const r = await c.fetch('/api/auth/email/verify', { method: 'POST', json: { email: 'none@example.com', code: '123456', terms: termsConsent } });
    expect(r.status).toBe(400);
    expect(await env.DB.prepare('SELECT id FROM terms_acceptances').first()).toBeNull();
  });

  it('requires current consent for Google start, including direct and cross-origin requests', async () => {
    const c = new Client(makeEnv());
    for (const terms of [undefined, { ...termsConsent, accepted: false }, { accepted: true, version: 'old' }]) {
      const r = await c.fetch('/api/auth/google/start', { method: 'POST', json: { terms } });
      expect(r.status).toBe(403);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    const legacy = await c.fetch('/api/auth/google/start?acceptedTerms=true&termsVersion=' + termsConsent.version);
    expect(legacy.status).toBe(303);
    expect(legacy.headers.get('location')).toBe('/?auth_error=terms_required');
    expect(legacy.headers.get('set-cookie')).toBeNull();
    const shelf = await c.fetch('/api/auth/google/start?next=/shelf');
    expect(shelf.status).toBe(303);
    expect(shelf.headers.get('location')).toBe('/shelf?auth_error=terms_required');
    expect(shelf.headers.get('set-cookie')).toBeNull();
    expect((await c.fetch('/api/auth/google/start', { method: 'POST', headers: { origin: 'https://evil.example' }, json: { terms: termsConsent } })).status).toBe(403);
  });

  it('rejects old Google handshakes at callback, even when signed and state-valid', async () => {
    const { signValue } = await import('../src/auth');
    const te = makeEnv(), c = new Client(te);
    for (const version of [undefined, 'old']) {
      const value = btoa(JSON.stringify({ s: 'state', v: 'verifier', n: '/book/return', t: Date.now(), termsVersion: version }));
      const signed = await signValue(te.env.SESSION_SECRET!, value);
      const r = await c.fetch('/api/auth/google/callback?state=state&code=code', { headers: { cookie: `ir_oauth=${encodeURIComponent(signed)}` } });
      expect(r.headers.get('location')).toBe('/book/return?auth_error=terms_updated');
      expect(await env.DB.prepare('SELECT id FROM terms_acceptances').first()).toBeNull();
      expect(await env.DB.prepare('SELECT id FROM sessions').first()).toBeNull();
    }
  });

  it('blocks legacy sessions until fresh consent and still permits logout', async () => {
    const te = makeEnv(), c = new Client(te);
    await c.login();
    await env.DB.prepare("UPDATE terms_acceptances SET terms_version = 'old'").run();
    for (const path of ['/api/auth/me', '/api/books']) {
      const r = await c.fetch(path);
      expect(r.status).toBe(403);
      expect(((await r.json()) as any).error.code).toBe('terms_required');
    }
    const upload = await c.fetch('/api/books', { method: 'POST', body: new FormData() });
    expect(upload.status).toBe(403);
    expect((await c.fetch('/api/auth/logout-all', { method: 'POST' })).status).toBe(200);
    expect((await c.fetch('/api/auth/me')).status).toBe(401);
  });

  it('does not infer fresh login consent from an earlier accepted login', async () => {
    const te = makeEnv(), c = new Client(te);
    await c.login('repeat@example.com');
    const r = await c.fetch('/api/auth/email/verify', { method: 'POST', json: { email: 'repeat@example.com', code: '000000' } });
    expect(r.status).toBe(403);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM terms_acceptances').first<any>()).n).toBe(1);
  });

  it('publishes bilingual, format-independent copyright terms and consent privacy disclosure', async () => {
    const c = new Client(makeEnv());
    const r = await c.fetch('/terms');
    const text = await r.text() + await (await c.fetch('/terms?lang=zh-CN')).text();
    expect(r.headers.get('cache-control')).toContain('no-store');
    for (const fragment of [termsConsent.version, 'Terms of Use', '使用条款', 'EPUB', 'any other format', 'Copyright complaint', '版权投诉', 'does not by itself authorise', '并不当然意味着', '自身违法行为或过错']) expect(text).toContain(fragment);
    expect(await (await c.fetch('/privacy?lang=en')).text()).toContain('Terms acceptance');
  });
});
