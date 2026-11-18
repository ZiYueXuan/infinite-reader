# Pi reading agent integration

Implementation date: 2026-10-25. Release validation is recorded below.

## Architecture

The application uses upstream `@earendil-works/pi-durable@1.4.0` through Cloudflare's official `agents@0.30.1` `PiHarness`. `pi-ai` and `chord` are pinned to `1.4.0`. We do not fork the execution kernel or maintain a second tool loop. Pi Durable is Experimental and PiHarness is Beta: upgrades require the integration tests, provider contract checks, and a live reading/chat check.

The introduced runtime's MIT copyright/license notices are preserved in [third-party notices](./pi-third-party-notices.md).

```text
Reading page → authenticated /api/ask → ReaderAgent Durable Object
                                      └─ PiHarness → Pi Durable
                                           ├─ metered DeepSeek provider
                                           ├─ get_book_outline → D1
                                           ├─ read_book_passage → D1
                                           └─ search_book → metered Embedding → Vectorize → D1
```

One SQLite Durable Object belongs to `(userId, bookId, threadId)`. Public routes check ownership; tools recheck ownership and use the server-bound book, never a model-supplied user/book ID. All initial tools are read-only and safe to replay. New write tools must have their own authorization and durable idempotency rules.

- **DO / Pi:** model/tool transcript, resumable execution, operation IDs, citation registry, budgets, context compaction.
- **D1:** books/chunks and existing application data, user-visible chat projection, per-call `ai_usage` ledger.
- **R2 / Vectorize:** existing EPUB/cover/recognition storage and semantic indexes remain in place.

Application concerns are isolated in `worker/src/agent/`: protocol/budgets, reading tools, provider metering, and the DO host. Frontend consumes application SSE events without importing Pi types.

## Behavior

The model can answer greetings and complete selections directly. Book questions can use the outline, search, and sequential passage reads; Embedding runs only when `search_book` is called. Reading position is context, not an instruction to always retrieve from the current page. Prompts require evidence-backed citations and disclosure of incomplete chapter coverage.

The system prompt in `worker/src/agent/protocol.ts` includes mainland-China audience
conventions: simplified Chinese by default for Chinese replies, standard mainland
political/historical terminology, national sovereignty/unity, and appropriate
Hong Kong/Macao/Taiwan designations. This presentation policy also requires source
attribution, faithful quotations, and a clear distinction between facts, official
positions, disputed interpretations, and inference. It must not manufacture facts
or inject political commentary into unrelated questions. Battle outcomes must
distinguish a specific engagement from a wider campaign. These are model
instructions, not a deterministic content-compliance filter or a guarantee of
every generated answer.

Source numbers are stable within each conversation, including follow-ups. Only known sources referenced in the final answer become persisted citation links. Existing inline superscripts and chapter navigation remain compatible. On first use, up to 12 old chat messages are imported as bounded, untrusted history; old citation numbers are stripped and must be re-established from tools.

Each turn allows 6 model calls, 8 tools, 180 seconds and 4,096 output tokens per model call. Retries and compaction consume the same budget. The application uses a conservative 32K context window, blocking compaction with an 8K reserve and 4K recent-token budget; background compaction is disabled to keep accounting within a user operation. Pi handles model/tool protocol, compaction and one transient-error retry; the provider SDK's internal retries are disabled so every actual attempt can be metered separately.

The provider adapter starts a D1 usage record before calling the model and finalizes reported usage before forwarding its terminal event. Missing counters remain unknown, never zero. Existing embedding/map recognition recording is unchanged. An abrupt runtime termination can still leave a pending row; do not interpret that as a free call. See [AI usage ledger](./ai-usage.md).

## Persistence, cancellation and clearing

Clients generate a stable `operationId` before admission. Repeating the same request replays/watches that operation; changing its contents under the same ID is rejected. Only one turn runs at a time within a conversation.

SSE `answer` events replace text rather than append, so a reconnect can restore a complete snapshot. A network disconnect does not cancel the durable task. History returns any pending operation and the UI resumes it over GET. Explicit Stop calls `/api/ask/cancel`; a Stop racing ahead of admission leaves a cancellation tombstone. Completing an operation projects the answer into D1 idempotently; a later history read also reconciles completed Pi work.

Clearing chat stops execution, disables alarms, drains active stream watchers, disposes the runtime and deletes its storage, then clears the D1 projection. Lifecycle reset and request admission are serialized so a concurrent request cannot reuse the disposed runtime. Deleting a book clears its known conversation threads first. Usage records are retained.

## Deployment and recovery

`wrangler.jsonc` introduces SQLite class `ReaderAgent` under migration `v1-reader-agent` and binding `READER_AGENT`; no new D1 schema migration is needed. Existing `0002_ai_usage.sql` must already be applied. Existing Worker secrets are reused.

Deploy the frontend and Worker together because the chat stream now uses replacement `answer` events. For rollback, restore a previously validated frontend/Worker version together. Do not remove or rename the DO class/migration merely to roll back business logic, and do not delete DO storage as a rollback step. D1 retains the user-facing chat history. Preserve the pinned upstream versions and test before upgrading.

## Verification

- Workers runtime suite: 83 tests passed, including direct answers, repeated search, outline/passage reads, protocol/reasoning continuity, HTTP retry, unknown usage on failure, automatic compaction billing, hard budget termination, ownership, idempotency after object restart, clearing and explicit cancellation.
- Frontend suites: 16 tests passed (6 stream/reconnect tests and 10 answer/citation/navigation tests), including fragmented UTF-8/CRLF, incomplete streams, snapshot replacement, stable admission IDs, restored operation watching and explicit cancellation.
- Worker typecheck and frontend production build passed. Build retains existing large Three.js/MapLibre chunk notices.
- Final production version: `worker-version-id`, deployed on 2026-10-25 at `https://reader.example.workers.dev`. Main frontend asset: `/assets/index-BWP1tKVO.js`. Health and deployed HTML were verified. The SQLite DO binding/migration is active; no D1 migration was pending.
- The built-in browser verified real DeepSeek answers, inline citation navigation to the correct chapter, and completed conversation restoration after refresh. D1 contains four user messages and four assistant messages for these four acceptance turns; every model/embedding call has a usage row.

| Production acceptance turn | Model calls | Embedding calls | Reported model input/output tokens |
| --- | ---: | ---: | ---: |
| Greeting | 1 | 0 | 1,047 / 58 |
| Inspect outline and read chapter 1 | 3 | 0 | 7,586 / 425 |
| Search reasons for an alliance with Russia | 2 | 2 | 19,020 / 486 |
| Compare the openings of chapters 3 and 4 | 2 | 0 | 34,860 / 339 |

The embedding binding did not return token counters for the two search calls. Both calls are recorded with `usage_status = unavailable` and null counters, not estimated zeros. Production refresh was checked after completion; interrupted-stream recovery and explicit cancellation were verified in runtime/client tests. These are separate verification scopes.

The tests use deterministic fake providers. They verify execution contracts and accounting, not the quality of every model decision or long-running production eviction behavior. A restarted completed operation is covered; interruption during an external provider request can require another billed attempt on recovery.
