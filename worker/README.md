# Infinite Reader – Cloudflare Worker backend

TypeScript + [Hono](https://hono.dev) Worker that provides auth, EPUB storage/indexing, annotations/notes, and a Pi-powered reading agent (DeepSeek), and serves the built frontend (`../web/dist`) as static assets from the same Worker. API reference: [`API.md`](./API.md).

| Concern | Cloudflare product |
| --- | --- |
| Static frontend | Workers Static Assets (`run_worker_first: ["/api/*"]`, SPA fallback) |
| Users, sessions, books, chunks, annotations, notes, chat | D1 (`DB`, migrations in `migrations/`) |
| Uploaded EPUBs + covers | R2 (`BOOKS`) |
| Async indexing (parse → chunk → embed) | Queues (`INDEX_QUEUE`, DLQ `reader-index-dlq`); falls back to `ctx.waitUntil` when no queue is bound |
| Embeddings | Workers AI `@cf/baai/bge-m3` (1024-d, multilingual) |
| Vector search | Vectorize `reader-chunks` (cosine, 1024-d), one **namespace per book** |
| Email login codes | Cloudflare Email Service (`send_email` binding `EMAIL`), `login@example.test` |
| Google login | OAuth 2.0 authorization code + PKCE |
| LLM | DeepSeek (OpenAI-compatible `/chat/completions`, streamed) |
| Agent execution and durable conversation | Pi Durable via official Cloudflare `PiHarness`, SQLite Durable Object (`READER_AGENT`) |

## How it works

- **Auth**: email code (6 digits, HMAC-hashed, 10 min expiry, 5 attempts, 30 s cooldown, per-email and per-IP rate limits in D1) or Google. Sessions are random 256-bit tokens stored hashed in D1 and sent as `HttpOnly; Secure; SameSite=Lax` cookies (`__Host-` prefixed on HTTPS). Mutating requests with a foreign `Origin` are rejected.
- **Upload pipeline** (`src/pipeline/`): `POST /api/books` → R2 → queue message `parse` → unzip (fflate) + OPF/nav/NCX parse + XHTML → text → paragraph/sentence chunks (~900 chars, 120 overlap, offsets kept) stored in D1 → `embed` messages of 32 chunks → Workers AI → Vectorize upsert → `books.status = ready`. Each stage is idempotent and retried by Queues (5 attempts, then the book is marked `failed`). Poll `GET /api/books/:id/status`.
- **Ask** (`src/agent/`, `src/routes/ask.ts`): Pi chooses whether to answer directly, inspect the outline, search, or read consecutive passages. Only semantic search invokes query Embedding. Durable conversations retain tool results and stable citations; SSE replacement snapshots support reconnect without duplicate text/inference. Explicit Stop cancels the task. See [integration and limits](../docs/pi-agent-integration.md).
- **AI metering**: every map recognition, fallback, streamed answer and embedding request has a durable `ai_usage` record. Input/output/cache/reasoning counters are captured when reported; missing usage stays NULL. See [coverage, failure handling and queries](../docs/ai-usage.md).

> Vectorize writes are asynchronous: a freshly indexed book can take up to a minute or two before all vectors are queryable. Answers still work meanwhile (they just have fewer/no citations).

## Layout

```
worker/
  wrangler.jsonc        production config (bindings, vars)
  wrangler.test.jsonc   config used by vitest
  migrations/           D1 schema
  src/                  index.ts (Hono app + queue consumer), auth.ts, rag.ts, routes/, pipeline/, lib/
  test/                 vitest + @cloudflare/vitest-plugin (workerd, real D1/R2, fake AI/Vectorize/Email)
```

## Local development

```bash
cd worker
npm install --legacy-peer-deps      # the vitest plugin lists vitest 4 and 5 as peers
cp .dev.vars.example .dev.vars      # fill in secrets; .dev.vars is git-ignored
npm run db:migrate:local
npm run dev                         # http://localhost:8787
npm test                            # unit + integration tests
npm run typecheck
```

`wrangler dev` runs D1/R2/Queues locally. Workers AI and Vectorize are not simulated locally — add `"remote": true` to those bindings (or use the deployed Worker) when you need real embeddings. For email in dev either set `"remote": true` on the `send_email` binding or read the code from D1 (`login_codes` stores only hashes, so use the deployed Worker for real mail).

Run the frontend with a Vite proxy so `/api` is same-origin (cookies + CSRF check):

```ts
// web/vite.config.ts
server: { proxy: { "/api": "http://localhost:8787" } }
```

## Configuration

Vars (`wrangler.jsonc`): `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_ALLOWED_MODELS`, `EMBEDDING_MODEL`, `MAX_UPLOAD_MB`, `EMAIL_PROVIDER` (`cloudflare` | `resend` | `none`), `EMAIL_FROM`, `ALLOWED_EMAILS` (optional comma-separated allowlist), `ALLOWED_ORIGINS`, `PUBLIC_BASE_URL`, `SESSION_TTL_DAYS`.

Secrets (`wrangler secret put <NAME>`, never committed):

| Secret | Purpose |
| --- | --- |
| `SESSION_SECRET` | HMAC key for code hashes and OAuth state cookie |
| `DEEPSEEK_API_KEY` | LLM access (without it `/api/ask` returns `503 llm_not_configured`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google login (hidden from `/api/auth/providers` when unset) |
| `RESEND_API_KEY` | only if `EMAIL_PROVIDER=resend` |
| `COST_DEBUG_EMAILS` | Optional comma-separated allowlist for the cost debug panel. Set it as a Worker secret. |

Email has **no silent fallback**: with `EMAIL_PROVIDER=none` (or a missing binding/key) requesting a code returns `503 email_not_configured`.

## Deploy

One-time resource creation (already done for the production account):

```bash
npx wrangler d1 create infinite-reader                      # put database_id into wrangler.jsonc
npx wrangler r2 bucket create reader-books
npx wrangler vectorize create reader-chunks --dimensions=1024 --metric=cosine
npx wrangler queues create reader-index
npx wrangler queues create reader-index-dlq
npx wrangler email sending enable <your-zone>               # Workers Paid + Cloudflare-DNS zone
```

Release:

```bash
npm --prefix ../web run build          # produces web/dist (assets directory must exist)
npm run db:migrate:remote
npm run deploy
```

Set `account_id` if needed and replace the example D1 ID and resource names
with your own values. For a custom domain, configure `routes` in `wrangler.jsonc`.
Set `CONTACT_EMAIL` to your public support address before deployment. Configure
the email provider and its sender separately if you enable email login.

Register `<origin>/api/auth/google/callback` for each origin used with Google OAuth.

Keep `PUBLIC_BASE_URL` empty so callbacks use the request's origin and its corresponding session cookie. Local development also needs the `http://localhost:8787` / `:5173` callback equivalents.

## Terms of Use and consent

`/terms` serves the bilingual agreement in `src/legal/terms-2026-10-29.ts`. Both email verification and Google sign-in require explicit consent to `shared/terms.ts`'s current version. Legacy GET login links redirect to the reader sign-in dialog (preserving valid book paths), without creating an OAuth cookie or accepting terms from query parameters. Google starts via a same-origin POST returning `{ url }`, and binds the version to the signed OAuth handshake. Each successful login records the user, version, acceptance/recording timestamps and method in `terms_acceptances`; failed verification records nothing. No raw IP or additional browser fingerprint is collected for consent.

Apply migration `0003_terms_acceptances.sql` before deploying this release. It is additive and deliberately does not backfill consent. Existing users must sign in again and accept before using authenticated APIs; logout and public legal pages remain accessible. When revising the agreement, preserve the previous text, publish the new version, bump the shared version and update tests. New versions require renewed explicit acceptance; a frontend checkbox alone is not the enforcement boundary.
