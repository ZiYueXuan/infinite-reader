# Infinite Reader API

Backend served by the Cloudflare Worker in `worker/`. The same Worker serves the built frontend (`web/dist`) as static assets; only `/api/*` runs Worker code.

- Base URL (production): `https://reader.example.workers.dev`
- All endpoints are under `/api`. Request and response bodies are JSON unless stated otherwise.
- Auth is a **cookie session** (`HttpOnly; Secure; SameSite=Lax`, cookie `__Host-ir_session` over HTTPS, `ir_session` over plain HTTP in local dev). Use `credentials: "include"` (same-origin `fetch` does this by default). There is no bearer token.
- State-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`) carrying a cross-origin `Origin` header are rejected with `403 bad_origin`. For local frontend development proxy `/api` to the Worker (Vite `server.proxy`) so everything is same-origin, or list the dev origin in `ALLOWED_ORIGINS`.
- IDs are opaque strings. Timestamps are Unix epoch **milliseconds**.

## Errors

Every error uses the same envelope:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests, slow down", "retryAfter": 12 } }
```

| Status | Typical `code` |
| --- | --- |
| 400 | `invalid_request`, `invalid_json`, `invalid_code`, `empty_file` |
| 401 | `unauthorized` |
| 403 | `bad_origin` |
| 404 | `not_found`, `no_cover`, `file_missing` |
| 409 | `conflict` (client-supplied id already exists) |
| 413 / 415 | `too_large` / `not_epub` |
| 429 | `rate_limited`, `cooldown` (also sets `Retry-After`) |
| 502 / 503 | `email_send_failed`, `llm_error`, `llm_unreachable` / `email_not_configured`, `google_not_configured`, `llm_not_configured` |

## Auth

### `GET /api/auth/providers`
Which login methods are usable on this deployment (use it to decide which buttons to show).
`200 { "email": boolean, "google": boolean }`

### `GET /api/auth/me`
`200 { "user": { "id", "email", "name", "avatar_url", "can_view_cost_debug": boolean } }` or `401`.
The Worker computes `can_view_cost_debug` for the signed-in user from its own configuration.

### `POST /api/auth/email/request`
`{ "email": "a@b.com" }` → `200 { "ok": true, "expiresInSec": 600 }`.
Sends a 6-digit one-time code (valid 10 minutes, single use, max 5 wrong attempts). Always returns 200 for a well-formed address (no account enumeration). Limits: 30 s resend cooldown per address (`429 cooldown`), 5 per hour per address, 20 per hour per IP. `503 email_not_configured` if the deployment has no mail transport.

### `POST /api/auth/email/verify`
`{ "email": "a@b.com", "code": "123456" }` → `200 { "user": {...} }` and sets the session cookie. `400 invalid_code` for wrong/expired/used codes.
Codes are stored as `HMAC-SHA256(secret, "otp:<email>:<code>")`, never in clear.

### `GET /api/auth/google/start?next=/path`
Browser navigation (not `fetch`). `302` to Google (authorization code + PKCE; scopes `openid email profile`). `next` must be a same-site absolute path (default `/`). `503` if Google login is not configured.

### `GET /api/auth/google/callback`
Redirect URI registered with Google: `<origin>/api/auth/google/callback`. On success sets the session cookie and `302` to `next`. On failure `302 /?auth_error=<code>` (`google_denied`, `invalid_oauth_state`, `google_token_failed`, `google_email_unverified`, `email_not_allowed`, …). Accounts are matched by Google `sub`, then by verified email (so email-code and Google logins for the same address are the same user).

### `POST /api/auth/logout` · `POST /api/auth/logout-all`
`200 { "ok": true }`. The latter ends every session of the user.

## Books

A book row is created on upload and indexed asynchronously (Queues): `uploaded → parsing → indexing → ready` (or `failed`).

### `POST /api/books`
Upload an EPUB (max `MAX_UPLOAD_MB`, default 50). Two accepted forms:

- `multipart/form-data` with field `file` (and optional `title`)
- raw body with `Content-Type: application/epub+zip` and header `X-Filename: <url-encoded name>`

`202 { "book": BookSummary }`. Errors: `413`, `415 not_epub`, `400 empty_file`, `429` (20 uploads/hour).

### `GET /api/books`
`200 { "books": BookSummary[] }` (newest first).

```ts
type BookSummary = {
  id: string; title: string; author: string | null; language: string | null; description: string | null;
  filename: string | null; sizeBytes: number; hasCover: boolean;
  status: "uploaded" | "parsing" | "indexing" | "ready" | "failed"; error: string | null;
  chapterCount: number; chunkCount: number; indexedChunks: number;
  progress: { percent?: number; chapterIndex?: number; location?: unknown; updatedAt: number } | null;
  createdAt: number; updatedAt: number;
};
```

### `GET /api/books/:id`
`200 { "book": BookSummary & { toc: {title, href, level, chapter: number|null}[]; state: unknown|null; bibliography: BookBibliography|null } }`.
`BookBibliography` is defined in `shared/bibliography.ts`. It contains extracted, unverified source evidence, separate from user-edited title/author. The bookshelf list intentionally omits this larger payload.

### `GET /api/books/:id/metadata`
Owner-only: `200 { bibliography: BookBibliography|null, attemptedAt: number|null, error: string|null, status: 'ready'|'failed'|'pending'|'not_extracted' }`.
No extraction is triggered by this endpoint. A pending task may need retry if enqueueing/execution was interrupted; after five minutes POST can claim it again.

### `POST /api/books/:id/metadata`
Owner-only metadata backfill for existing ready books. Returns stored metadata with `200 { bibliography, status: 'ready' }`, or schedules extraction with `202 { status: 'pending' }`. Pending claims are deduplicated for five minutes; up to 30 uncached requests/user/hour. Returns `409 book_not_ready` until parsing/indexing completes. Does not re-index, call AI, overwrite display names, or modify reading state. It does not force-refresh already saved metadata.

### `GET /api/books/:id/status`
Poll while indexing. `200 { id, status, error, chapterCount, chunkCount, indexedChunks, percent (0-100), updatedAt }`.

### `GET /api/books/:id/file`
The original EPUB (`application/epub+zip`), supports `Range`. Use it as the source for the client-side reader engine. Private cache, `ETag`.
Opening an existing ready book with no bibliography schedules a best-effort metadata-only backfill. Failures never change the book's reading/indexing status or fail its download.

### `GET /api/books/:id/cover`
Cover image or `404 no_cover`.

### `PATCH /api/books/:id`
`{ title?, author? }` → `{ book }`.

### `PUT /api/books/:id/progress`
`{ percent?: 0-100, chapterIndex?: int, location?: any }` (≤ 8 KB) → `{ ok, progress }`.

### `PUT /api/books/:id/state`
Opaque JSON blob (≤ 256 KB) for client state such as the canvas viewport; returned as `book.state` by `GET /api/books/:id`.

### `POST /api/books/:id/reindex` → `202 { ok: true }`
### `DELETE /api/books/:id` → `{ ok: true }`
Deletes the file, cover, chunks, vectors, annotations, notes and chat history.

## Annotations (highlight / underline)

Collection: `/api/books/:bookId/annotations`. All routes require the book to belong to the user (`404` otherwise).

```ts
type Annotation = {
  id: string; bookId: string;
  kind: "highlight" | "underline";
  color: string;                 // "#rrggbb" or a named colour
  anchor: Anchor;                // see below
  text: string | null;           // quoted text
  noteId: string | null;         // optional link to a sticky note
  createdAt: number; updatedAt: number;
};
```

- `GET ?since=<ms>` → `{ annotations }` (only rows with `updatedAt > since`; deletions are not reported, do a full list to reconcile).
- `POST { id?, kind, color?, anchor, text?, noteId? }` → `201 { annotation }`. `id` may be client generated (8–64 chars `[A-Za-z0-9_-]`, e.g. a UUID) for optimistic UI; reuse → `409`.
- `PATCH /:id { kind?, color?, noteId? }` → `{ annotation }`. (The range is immutable; delete and recreate to change it.)
- `DELETE /:id` → `{ ok: true }`.

**Anchor** — an open JSON object (non-empty, ≤ 8 KB) owned by the reader engine; the server stores and returns it verbatim. Recommended keys: `href` (chapter file), `spineIndex`, `cfi`, `start`/`end` (character offsets in the chapter's plain text), `startPath`/`startOffset`/`endPath`/`endOffset` (DOM range), and `quote`/`prefix`/`suffix` for fuzzy re-anchoring.

## Sticky notes (canvas)

Collection: `/api/books/:bookId/notes`.

```ts
type Note = {
  id: string; bookId: string; text: string; color: string;
  x: number; y: number;            // canvas position
  width: number | null; height: number | null; z: number;
  annotationId: string | null; anchor: Anchor | null;
  createdAt: number; updatedAt: number;
};
```

- `GET ?since=<ms>` → `{ notes }`
- `POST { id?, text?, color?, x?, y?, width?, height?, z?, annotationId?, anchor? }` → `201 { note }`
- `PATCH /:id` (any subset of the fields above, `null` clears nullable ones) → `{ note }`
- `DELETE /:id` → `{ ok: true }`

## AI chat

### `POST /api/ask`  (Server-Sent Events)

```json
{
  "bookId": "…",
  "question": "What does this passage mean?",
  "operationId": "a-client-generated-uuid",
  "selection": { "text": "selected passage", "chapterTitle": "Chapter 2", "anchor": { } },
  "context": { "before": "text before the selection", "after": "text after", "chapterTitle": "Chapter 2" },
  "threadId": "default",
  "readingPosition": { "chapter": 1, "start": 0 },
  "model": "deepseek-chat",
  "topK": 6
}
```

Only `bookId` and `question` are required. Clients should generate `operationId` once and reuse it for retries. Pi Durable retains the full conversation/tool protocol per user/book/thread and compacts old context when needed. The initial conversation imports up to 12 legacy messages as bounded history. `model` must be in `DEEPSEEK_ALLOWED_MODELS`, otherwise the default is used. Limit: 30 admission requests/minute per user, 4,000 question characters, 60,000 bytes of normalized input.

The model chooses among `get_book_outline`, `search_book`, and `read_book_passage`. Only `search_book` calls Embedding/Vectorize, scoped to the authorized book. Source numbers remain stable throughout the conversation. Each turn has a maximum of 6 model requests (including retry/compaction), 8 tool calls and 180 seconds. Each model attempt and embedding call is recorded separately in `ai_usage` with the same `operation_id`.

Response: `200 text/event-stream`. Pre-stream failures are normal JSON errors (`400`, `404`, `409 agent_busy|operation_conflict|agent_cancelled`, `429`, `503 llm_not_configured`). Events:

| event | data |
| --- | --- |
| `meta` | `{ operationId, messageId, userMessageId, model, retrieval: "ok"\|"skipped"\|"failed", citations: Citation[] }` — repeated as sources change; replace citations, including an empty list |
| `answer` | `{ text }` — replace the current answer in full; never append this event. Sources use `[n]` matching `citations[].n` |
| `tool` | `{ name }` — active reading tool, suitable for a progress label |
| `done` | `{ operationId, messageId, userMessageId, status: "done"\|"aborted" }` |
| `error` | `{ code, message }` — stream interrupted after it started |

```ts
type Citation = {
  n: number;                  // matches [n] in the answer
  chunkId: string; ordinal: number;
  chapterIndex: number; chapterTitle: string | null; chapterHref: string | null;
  charStart: number; charEnd: number;   // offsets in the chapter plain text
  snippet: string;            // first 240 chars of the chunk
  score: number;              // cosine similarity for search; 1 for direct passage reads
};
```

Consume with `fetch` + `ReadableStream`. A disconnected SSE does not cancel the durable task. The user message and assistant answer/citations are projected into D1; Pi execution state remains in the Durable Object. EOF without a terminal event requires reconnection. Internal reasoning stays in the server-side model protocol.

### `GET /api/ask/stream?bookId=…&threadId=default&operationId=…`

Reconnect to the same operation using the same SSE protocol. Completed operations replay their answer without invoking the model. An identical `POST /api/ask` is also idempotent; reusing the ID with changed input returns `409 operation_conflict`.

### `POST /api/ask/cancel`

Body: `{ bookId, threadId?, operationId }`. Explicitly stops this operation. A cancellation arriving before admission prevents that ID from starting later. All endpoints require book ownership.

### `GET /api/books/:bookId/chat?threadId=default`
`200 { messages: { id, threadId, role: "user"|"assistant", content, selection, citations, model, createdAt }[], pending: { operationId, messageId, userMessageId } | null }`. Resume `pending` after restoring the messages.

### `DELETE /api/books/:bookId/chat[?threadId=…]` → `{ ok: true }`

Stops the active task and clears both Pi context and the D1 chat projection. Deleting the book also clears its conversations. AI usage records are retained.

## Misc

- `GET /api/health` → `{ ok: true, name, time }`
- Unknown `/api/*` → `404 not_found`. Everything else is served from `web/dist` with SPA fallback to `index.html`.

### Atlas recognition cache

`GET /api/books/:id/atlas?cursor=...` returns `{ maps: [{ map, recognizedAt }], cursor: string | null }` for successfully recognized saved maps. Authentication and ownership are required; responses are private/no-store. Pages contain up to 100 cache records (negative or invalid entries are omitted). Historical successful results remain available after inference-cache expiry. Clients deduplicate image hashes, preferring the latest recognition, and resolve source image anchors locally. This endpoint never invokes AI.

`POST /api/books/:id/atlas` accepts `{ path, refresh?: boolean }`. Ownership is checked before any cache read or inference.

Results are stored in R2 under the user's book namespace, keyed by SHA-256 of the original image bytes. Identical image bytes within that book reuse a result even when their archive path or EPUB packaging changes. This does not deduplicate across different books or users.

- Confident `not_map` results have no time-based expiry and survive recognition-version changes.
- `recognized` results retain a 30-day cache; `uncertain` results retain a 24-hour cache. These require the current recognition version.
- `refresh: true` explicitly bypasses cached results, remains rate limited, and records actual model usage.
- Existing current-version path-based caches are migrated lazily without inference, including expired `not_map` results.
- Provider failures are not cached. Cache hits do not create model-usage records. Deleting a book removes its recognition caches.
