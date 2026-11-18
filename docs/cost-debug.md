# Cost debug window

Set the optional Worker secret `COST_DEBUG_EMAILS` to a comma-separated list of allowed email addresses. The Worker checks the signed-in user's address on every cost request and sends the browser a `can_view_cost_debug` boolean. An empty allowlist disables the panel. On both bookshelf and reading pages, open the top-right account capsule and select **费用 · DEBUG**; the panel opens below the capsule and disappears completely when closed. Hidden panels do not poll, but preserve the observation period and filters. There is no lower-left launcher; each page starts with the panel hidden, and closing it returns focus to the account capsule. It starts an observation period on first use (kept per account in sessionStorage). **Reset observation changes the time filter, not stored records.** Today uses the browser's local midnight. A book filter includes that book's AI, HTTP and background indexing records; account scope also includes shelf and deleted-book activity. It polls every 15 seconds while expanded and visible, with cancellation on scope/account changes. Offline mode makes no cost requests.

The USD figure is a **known gross cost estimate at current public list rates**, not an invoice or a complete cost of serving the account. Free allocations, account-wide discounts, billing-unit rounding, taxes and minimum subscriptions are not apportioned. Missing usage is explicitly unknown, not zero. Failure/retry/fallback AI calls are separate records; measured failed calls still incur estimated costs. No AI calls are made just to inspect costs.

Operation details appear first, ordered by start time from newest to oldest. Each record shows a full date and time to the second in the browser’s local timezone; the timestamp tooltip names that timezone. Category totals are collapsed below the details and sorted by their latest operation time, with that timestamp shown as “Latest”. The API includes `groups[].latestStartedAt`; changing the presentation order does not change cost calculations, filtering, or summary coverage.

**Search only** filters server-side (`feature=web_search`) before record limits, so progress saves cannot push searches out of the latest 100 details. It scopes operation totals, groups and exports to search calls, preserves time/book/account access restrictions, and includes `feature` in the exported snapshot. Original-book storage remains a separate monthly projection.

## Coverage

- DeepSeek web search (2026-11-14) uses `provider=deepseek`, `requested_model=deepseek-search`. A valid nonempty HTTP 200 response costs $0.00075; empty results and explicit provider HTTP failures cost $0. Local timeout/cancellation or malformed responses without confirmed billing counts remain unknown. `search_billable_requests` is separate from successful response counts, appears in the cost panel/export, and is measured before filtering unsafe links. New searches use the DeepSeek balance, without Cloudflare credit fees. Chat tokens are recorded on separate calls. [Official rules](https://api-docs.deepseek.com/guides/search/).
- Historical Ceramic web search uses application-observed successful response counts (`search_requests=1`), not tokens. As checked on 2026-11-12, [Cloudflare lists $0.25 per 1,000 requests](https://developers.cloudflare.com/web-search/providers/) and [Unified Billing charges 5% when paid credits are purchased](https://developers.cloudflare.com/ai-gateway/features/unified-billing/). Each confirmed success is therefore estimated as **$0.00025 search + $0.0000125 allocated credit purchase fee = $0.0002625**. This assumes purchased credits, does not deduct promotions, and does not charge the top-up principal again. Both components are shown separately, with sufficient decimal precision. This updates search pricing only; the other rates retain their 2026-10-29 verification date.
- Search counts are classified as partial usage, with token fields remaining NULL. `search_attempts=1` is recorded when dispatch starts; it is **not** sufficient to assign a price. Old successful rows containing only `search_requests=1` are priced on read without a database migration. A successful response followed by an application cancellation can still have a valid estimate. Missing/invalid counts, running calls, unsupported providers and unconfirmed failures remain unknown, never free. Zero results still count as one successful request.
- Search details/exports include the observed attempt count, successful count, HTTP status, optional provider request ID, error code, operation ID and search-pricing version. These support manual reconciliation in Cloudflare. The application does **not** currently import authoritative credit deductions or invoices; late responses after timeout/cancellation are discarded, and actual billing for those attempts remains unresolved. Provider confirmations must not be inferred from the app's success status.

- Existing durable `ai_usage` supplies provider-reported usage for question answering, chapter/section mind maps, embeddings and map recognition, including retries. Response-model pricing takes precedence over a requested alias. Unknown models stay unknown. Cached input and output are priced separately; reasoning is already included in output. Cloudflare neurons take precedence over token pricing to avoid double charging.
- BGE-M3 often does not return tokens. New calls also record **only the input character count** and use a labeled rough approximation of characters / 2 tokens. Old records without tokens or characters cannot be reconstructed. This approximation is not a tokenizer or a reliable bound.
- A per-request meter counts Workers HTTP requests, D1 returned rows-read/rows-written metadata, and successful R2 Class A/B operations. `first()` uses `all()` for billing metadata, keeping first-row/column semantics; batches unwrap native D1 statements. Failed/unrecognized operations increment an unknown counter. Diagnostic persistence is fail-open and never retries a paid call. Index parsing/batches have independent scopes, including the inline local queue fallback.
- Original book bytes × R2 Standard monthly rate is displayed **separately**, not added to operation totals. It is a current-size monthly projection, not historic GB-month consumption.
- Not metered: Workers CPU, Durable Objects and Agent-internal D1/R2, Vectorize, Queues, email, provider logs, D1 storage, cover/map-cache storage, and lost diagnostic writes. The observer endpoint, authentication and `cost_events` persistence are excluded to avoid self-generated accumulation (they still consume provider resources). This view cannot determine net per-customer profitability yet.

## Pricing snapshot (2026-10-29)

Rates are USD per million tokens unless specified. Current rates reprice history; no historic tariffs are claimed. Review `worker/src/lib/costPricing.ts` before relying on estimates after a supplier price/model change.

| Product | Rates | Official source |
| --- | --- | --- |
| DeepSeek Flash | peak input .30 / cache .006 / output 1.20; off-peak half | https://api-docs.deepseek.com/quick_start/pricing/ |
| DeepSeek V4 Pro | peak input 1.32 / cache .044 / output 3.96; off-peak half | same |
| Workers AI | .011 per 1,000 neurons | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| BGE-M3 | input .0118 | https://developers.cloudflare.com/workers-ai/models/bge-m3/ |
| GLM-5.3 Flash | input .15 / cache .03 / output .50 | https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/ |
| Workers requests | .30 per million requests | https://developers.cloudflare.com/workers/platform/pricing/ |
| D1 | .001 / million read rows; 1 / million written rows | https://developers.cloudflare.com/d1/platform/pricing/ |
| R2 Standard | 4.50 / million A; .36 / million B; .015 / GB-month | https://developers.cloudflare.com/r2/pricing/ |

DeepSeek peak windows are weekdays 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese holidays. Since there is no holiday calendar, calls in these windows show half-price to peak-price ranges. Missing cache breakdown shows all-cached to all-uncached bounds. The component breakdown shows the upper scenario. Range estimates and character approximations are visibly labeled.

## API / deployment

Apply additive D1 migration `0004_cost_debug.sql` before deploying the Worker. `/api/costs?since=<epoch-ms>&book=<optional-owned-id>` requires a session and current terms acceptance. Every query is account scoped; another account's book returns 404. Records contain counts/identifiers, not new text or prompts. Account deletion cascades diagnostics; deleting a book preserves costs with a null book reference.

At most 31 days and the newest 2,000 records per ledger contribute to totals. A truncated flag warns when the time/record cap applies. Only the latest 100 combined items are sent to the browser and exported, alongside the complete capped summaries, pricing version and exclusions; exports are snapshots, not an unlimited ledger download. Costs can arrive after the operation due to asynchronous persistence. Resetting mid-operation can exclude calls that began before the reset.

Validation: Worker integration tests cover pricing, unknown usage, retry totals, tenant/TOU isolation, real D1/R2 proxy semantics, upload/background attribution and observer exclusion. `web/scripts/check-cost-debug.mjs` exercises the panel using intercepted API fixtures (no real paid calls).

`web/scripts/check-cost-order.mjs` verifies recent-first details, cross-day local timestamps, collapsed category totals, mobile layout and English copy with a synthetic administrator account.
