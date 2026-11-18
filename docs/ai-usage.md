# AI usage ledger

Every actual model request made by the Worker is recorded in D1 `ai_usage`, using the shared recorder in `worker/src/lib/aiUsage.ts`. Migration: `worker/migrations/0002_ai_usage.sql` (apply before deploying the Worker).

## Coverage

| Feature | Provider | Granularity |
| --- | --- | --- |
| `atlas_primary` | DeepSeek | One map recognition attempt |
| `atlas_fallback` | Cloudflare / GLM | A separate fallback attempt, sharing the primary's `operation_id` |
| `mindmap` | DeepSeek | One chapter/section mind-map generation attempt; saved maps make no model request |
| `ask` | DeepSeek | One answer or tool-round attempt, including retries |
| `ask_summary` | DeepSeek | One history-summary attempt, including truncated segments and retries. Reusing a saved segment makes no provider call. Earlier releases recorded summaries under `ask`. |
| `retrieval_embedding` | Cloudflare / BGE-M3 | One question embedding request, sharing the answer's `operation_id` |
| `index_embedding` | Cloudflare / BGE-M3 | One embedding batch; queue retries create new attempt records |

A cached map result, a coalesced concurrent recognition request, or a rejected request that never reaches a model does not create another provider-call record. Each new AI integration must call `startAiCall` before invoking the provider, `observe` before validating business output, and await `finish` for both success and failure.

## Stored fields

- `id`: unique call id. An Agent turn can contain several calls; use SSE `operationId` to correlate all its D1 rows, rather than assuming one `usageId` per answer.
- `operation_id`, `user_id`, `book_id`: correlate attempts and related retrieval calls. Deleting a user/book sets its reference to NULL without deleting the metering record.
- `feature`, `provider`, `requested_model`, `response_model`, `provider_request_id`.
- `input_tokens`, `output_tokens`, `total_tokens`, `cached_input_tokens`, `uncached_input_tokens`, `reasoning_tokens`.
- `raw_usage`: numeric provider usage fields only, including nested details and Cloudflare `neurons` when returned.
- `status`: `started`, `succeeded`, `failed`, `aborted`.
- `usage_status`: `pending`, `reported` (both input/output returned), `partial` (some token counters returned), `unavailable` (no valid token counter returned).
- `finish_reason`, `http_status` when available, stable `error_code`, and millisecond timestamps/duration.

Provider usage is authoritative. Unknown counts are NULL, not zero, and are never estimated from characters or image dimensions. Total tokens can be derived from reported input + output if the provider omits the total; cached input and reasoning are subsets, not extra tokens to add again. Cumulative streaming usage snapshots replace/merge previous values rather than being summed.

Invalid map JSON, schema errors and truncated completions retain the tokens the provider returned. Timeouts, HTTP errors or a cancelled stream may never return usage; the attempt is still recorded with unknown counters. BGE-M3's binding currently returns vectors without token counters; these calls are recorded as `unavailable` unless the provider supplies usage. A successful recognition/inference does not guarantee usage was returned, and failed/aborted calls with unknown usage must not be assumed free. Old calls made before this migration cannot be reconstructed.

Only metering and identifier metadata are stored here: no prompts, images, book excerpts, answers, credentials or upstream error bodies. Costs are not calculated against hard-coded prices; the stored model, timestamp and cache counters support later billing reconciliation.

## Storage failure behavior

The `started` row must be persisted before inference. If it cannot be saved, no paid request is made. Completion updates retry once against the same id. If D1 remains unavailable, the exact final metering fields are saved in the existing R2 bucket under `ai-usage-recovery/<id>.json`; a log entry names the id and the D1 row remains `pending`. This retries storage only, never inference.

Recovery objects require reconciliation into the matching D1 row by id (update only the final fields, never insert a second call), then removal after verification. They contain no model inputs/outputs or user identity fields. Pending rows without recovery objects can also indicate a terminated Worker or a simultaneous D1/R2 outage; treat them as unknown, not zero. Final counters cannot be guaranteed after an abrupt platform termination before the provider response is received.

## Inspect production usage

From `worker/`:

```sh
npx wrangler d1 execute infinite-reader --remote --command "SELECT datetime(started_at/1000,'unixepoch') AS utc, feature, provider, requested_model, status, usage_status, input_tokens, output_tokens, total_tokens, cached_input_tokens, error_code FROM ai_usage ORDER BY started_at DESC LIMIT 30"
```

Aggregate reported values while explicitly showing missing/incomplete counters:

```sql
SELECT provider, requested_model, feature,
       COUNT(*) AS calls,
       SUM(CASE WHEN usage_status IN ('pending','partial','unavailable') THEN 1 ELSE 0 END) AS incomplete_usage_calls,
       SUM(input_tokens) AS known_input_tokens,
       SUM(output_tokens) AS known_output_tokens,
       SUM(cached_input_tokens) AS known_cached_input_tokens
FROM ai_usage
WHERE started_at >= ?
GROUP BY provider, requested_model, feature;
```

These totals include failed calls with reported usage, since invalid application output does not undo provider billing. Do not filter to successful calls when reconciling cost.
