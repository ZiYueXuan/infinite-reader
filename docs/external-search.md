# Explicit external search

The reading assistant keeps web search disabled by default. Only a direct request
in the **current question**, such as `请联网搜索鲁迅的生平` or `Search the web for
this author's biography`, enables `search_web` for that operation. `搜索本书`,
requests for recent information, ambiguous `找些资料`, selections, surrounding
book text, quoted instructions and previous conversation turns do not grant access.
A denial takes precedence. Recognition is deliberately conservative, supports
common Chinese/English request forms, and is not a general natural-language
classifier; when ambiguous, ask explicitly using `联网搜索` / `search the web`.

The service derives permission rather than accepting a client-supplied flag. The
model provider removes the tool from the request when permission is absent, and
the execution boundary checks the persisted permission and current question again.
Permissions do not persist into follow-up turns. Existing external citations can
still be discussed without performing another search.

## Current provider: DeepSeek (2026-11-14)

`search_web` now calls `POST /v1/tools/search` on `DEEPSEEK_BASE_URL`, using the
existing Worker `DEEPSEEK_API_KEY` secret. It sends only `{query, count: 5,
need_content: false}`. It does not send the original user question, book text,
conversation history, account identifiers or location. Chinese and multilingual
queries are supported (1–128 Unicode characters, no control characters); `site:`
and `lang:` operators are preserved. The prompt prefers Chinese for Chinese
topics and removes the old English-only restriction, including in existing chats.

Pi still owns the tool loop, permission checks, durable two-attempt budget,
duplicate-query guard and shared book/web citation numbering. This uses the
standalone Search API, not autonomous server-side `deepseek_web_search` or deep
thinking search. Image search and automatic URL fetching are not enabled.
The result's `summary` is preferred over `snippet`; at most five validated,
deduplicated HTTP(S) links and 1,200-character excerpts reach the assistant.

The 15-second deadline and caller cancellation abort the HTTP fetch and bound
waiting even if a transport ignores cancellation. No paid retry or provider
fallback is made. Late responses cannot update the ledger or citations.

Every attempt is persisted before dispatch with `feature=web_search`,
`provider=deepseek`, `requested_model=deepseek-search`. `search_attempts=1` records
dispatch; `search_requests=1` records a valid HTTP 200 response (including empty
results); `search_billable_requests=1` records nonempty upstream results and `0`
records empty results or an explicit provider HTTP failure. URL filtering happens
*after* metering: rejected URLs do not make a paid result free. Malformed HTTP 200,
network failure, local timeout and cancellation remain unknown without a receipt.
Provider request IDs are retained when returned in headers.

The [official Search API](https://api-docs.deepseek.com/guides/search/) charges
$0.75 per 1,000 successful, nonempty requests, independent of result count. Thus
at most two searches per turn cost $0.0015, excluding separately metered model
inference and hosting. These calls use the DeepSeek account balance, not
Cloudflare Unified Billing. There is no 5% Cloudflare credit purchase fee on new
searches. Historical Ceramic rows retain their original pricing branch. Prices
are estimates derived from observed responses and published rules, not invoice
reconciliation. No schema migration or new secret is needed.

Regression tests cover the real Pi harness with mocked search/model endpoints:
Chinese dispatch, private context exclusion, explicit permission, forged calls,
next-turn revocation, replay, stable citations, duplicate/budget checks, upstream
errors, empty/malformed responses, URL filtering, cancellation and timeout.
Cost tests preserve historical Ceramic rows and distinguish free from unknown.

### DeepSeek migration verification (2026-11-14)

All 341 Worker tests (20 files), Worker typecheck, frontend build and frontend lint
passed; lint retained three existing warnings. The 87 focused search/usage/cost
tests cover both new DeepSeek behavior and historical Ceramic accounting.
An isolated remote Worker preview reused the existing cloud secret and imported
the actual `searchWeb` and `priceAi` implementations. Chinese and English public
queries each returned HTTP 200 with five sources in approximately 0.4 seconds.
The Chinese query `平型关 战役 地图 lang:zh` returned, among other sources, the
Chinese military website's `《平型关之歼灭战》地图` page. Both attempts recorded
one successful, billable DeepSeek search and an estimated $0.00075, without
Cloudflare credit fees or invented token counts. This preview used an isolated
in-memory ledger; production persistence is verified separately below.

Deployed Worker version `worker-version-id` at 100% traffic.
Deployment includes the local working tree; no Git commit was created.

The authenticated production reader completed the Chinese request
`请联网搜索平型关战役的中文地图资料，优先中国军网，给出两条来源链接，简要回答。`
(operation `worker-version-id`). D1 recorded two successful
DeepSeek Search calls and two model calls, all HTTP 200. The UI cited Chinese
military website sources 137 and 142 and distinguished text summaries from
uninspected map images. The actual authenticated cost endpoint returned two
`deepseek-search` items at $0.00075 each, total $0.0015, with no credit fee.
The ordinary follow-up `把刚才的结果简要整理成两条。` (operation
`worker-version-id`) completed with one model call and zero
new searches, preserving both citations. These two test exchanges remain in
the owner's existing conversation. Evidence on the test machine:
`/tmp/deepseek-search-production-usage.json` and
`/path/to/.codex/visualizations/2026/11/07/01a1b563-4626-71b1-9c10-ebe2c3353fe5/deepseek-search-live.png`.

## Historical Ceramic implementation (retired 2026-11-14)

The following records describe the previous implementation and its original
release verification, not the current provider or current language support.

### Original provider and cost

Price comparison checked on 2026-11-12, excluding model inference and hosting:

| Provider / mode | Published price per 1,000 searches | Notes |
| --- | ---: | --- |
| Ceramic.ai, via Cloudflare | $0.25 | Selected; no Gateway markup |
| Parallel Fast / Turbo | $1 | Includes up to 10 results |
| Brave Search | $5 | Monthly free credits available |
| Tavily Basic PAYG | $8 | Monthly free credits available |

Sources: [Cloudflare providers](https://developers.cloudflare.com/web-search/providers/),
[Ceramic pricing](https://www.ceramic.ai/pricing),
[Parallel pricing](https://parallel.ai/pricing),
[Brave pricing](https://api-dashboard.search.brave.com/documentation/pricing),
[Tavily pricing](https://docs.tavily.com/documentation/api-credits).
This is the lowest unit price among these verified offers, not a claim about
every supplier or about which free allowance is best at very low volume.

Uses the existing `AI` binding and `env.AI.websearch`, explicitly selecting
`ceramic`, gateway `default`, and five results. No new dependency or database
migration is needed. The gateway requires credits or a Ceramic key stored as
its default provider key. See [Cloudflare setup](https://developers.cloudflare.com/web-search/how-to-use/).
Gateway credits were funded on 2026-11-12. Real REST and Worker-binding requests
with `Lu Xun biography museum` both returned HTTP 200 and four sources, including
the Ohio State University MCLC biography. Worker-binding latency was about 2.5s.

**Language limitation:** Ceramic currently indexes English webpages and rejects
non-Latin query characters. A Chinese query returned `502 provider_unavailable`
twice during the live check. This limitation is documented in Ceramic's
[best practices](https://docs.ceramic.ai/api/search/best-practices) and
[FAQ](https://docs.ceramic.ai/resources/faqs). The tool description and system
prompt therefore instruct the model to construct English keyword queries for
Chinese questions, while answering in the user's language and identifying the
English source coverage. Unsupported queries (non-ASCII characters, slashes/URLs,
or comma-separated numbers) are rejected **before** reserving search budget or
making a paid request. The model can correct its arguments within the existing
tool/model budget. Requests specifically requiring Chinese pages or exact Chinese
quotation lookup must explain the limitation, not substitute English coverage.
Preferences such as `最好是中文的` are not Chinese-only requirements: search with
English keywords, disclose English coverage, and summarize in Chinese. Map/image
requests retrieve source-page links, not image files or verified map labels.

Two attempts maximum per question, no automatic provider retry or more expensive
fallback. Normalized repeated queries are rejected before dispatch. Reservations
are durable; a crash between reservation and result persistence fails closed
rather than repeating a billed request. At list price, two successful searches
cost $0.0005 in search credits, plus $0.000025 allocated paid-credit purchase fees,
model tokens and hosting. Failed requests might still be billed
upstream; `ai_usage` records attempts/status, not an authoritative supplier invoice.

The query is limited to 300 characters and no account identifier, book passage,
or conversation context is automatically attached. Model instructions require
short public-topic queries. Results are capped at five excerpts of 1,200
characters. External content is untrusted evidence, never instructions. HTTP(S)
links are validated and opened separately from book navigation. Citations share
the conversation's source numbering, retain their search snapshot, and survive
history/reconnect projection without altering legacy book citation data.

Each actual attempt is recorded in the existing usage ledger as
`feature=web_search`, `provider=cloudflare`, `requested_model=ceramic`. Successful
responses record `search_requests=1`; unknown token usage remains NULL. All
attempts also retain `search_attempts=1` once dispatched. The cost panel estimates
successful searches plus the 5% purchased-credit fee, including older successful
ledger rows; unconfirmed charges remain unknown. See [cost accounting](./cost-debug.md).
Failed searches return a bounded tool error with no provider body or credentials.
Waiting stops after 15 seconds or cancellation/deadline. Cloudflare's binding
does not expose an abort option, so an already-admitted upstream request may
continue and incur cost; its late response is discarded.

## Validation

`worker/test/webSearch.test.ts` exercises permission, selection/history isolation,
forged calls, per-turn revocation, mixed source numbering, history, replay,
duplicate/budget limits, unsafe URLs, provider failures, timeout and cancellation
through the existing Pi harness with mocked providers, including Chinese-to-English
query correction without billing the rejected query. These automated tests do not
make paid calls or change production user messages. The separate manual smoke
check used only public biographical queries and the real funded AI binding; its
results establish transport/provider availability, not full live-model behavior
or Chinese-webpage coverage. Frontend citation/Markdown tests and
`web/scripts/check-agent-markdown.mjs` cover safe external links alongside the
existing passage-navigation behavior.

## Screenshot regression (2026-11-12)

Before this release, production was Worker version
`worker-version-id` (base commit `6f66f88`), which did not
include `search_web`. The pending matcher also rejected the exact screenshot
question `能使用外部搜索工具帮我找到平型关战役的地图么？最好是中文的`
because its request prefixes omitted `能`. Regression tests reproduced that
failure before the fix. The matcher now accepts this direct request while
keeping capability-only questions and explicit denials disabled. The current-turn
policy also tells the model that earlier assistant denials do not describe its
current tools. A harness regression covers old denial history, the exact question,
English query dispatch, and external citations; its model/search are mocked.

Released as Worker `worker-version-id`, tag
`web-search-20261112`, from base `6f66f88` plus the local search changes (not a new
Git commit). All 293 Worker tests, Worker typecheck, 11 targeted frontend tests,
and the production frontend build passed. The live `/shelf` entry assets matched
the local build byte for byte. A separate real Worker-binding probe using
`Battle of Pingxingguan map 1937` returned HTTP 200 and five source pages in
about 3.9 seconds; this verifies search availability, not the presence or quality
of a Chinese battle map.

After the owner signed in, the exact screenshot question was submitted through
the deployed reader in the existing conversation containing the old refusals.
Operation `worker-version-id` completed with two real DeepSeek
calls and two Ceramic searches, all HTTP 200 / succeeded in D1 `ai_usage`.
The UI displayed a Chinese answer and external citations 123–128, with cited
pages explicitly distinguished from unverified map images. The external source
link was verified to open in a new tab. The ordinary follow-up
`把刚才的结果简要整理成三条。` (operation
`worker-version-id`) completed with one model call and **zero**
new search calls, reusing the prior citations. This is a real authenticated
production check, not mocked provider evidence. The two test exchanges remain
in the owner's conversation. Evidence: `/tmp/search-authenticated-usage.json`,
`/tmp/search-authenticated-followup.json`, and
`/tmp/infinite-reader-live-search-verified.jpg` on the test machine.
