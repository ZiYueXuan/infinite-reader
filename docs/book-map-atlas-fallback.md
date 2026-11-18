# GLM map recognition fallback

Date: 2026-10-24

## Behavior

- DeepSeek Flash remains the primary image recognizer. Recognized maps and confident non-maps stop after one request.
- A transport failure, timeout, malformed/truncated output, uncertain region, or no matched city triggers one `@cf/zai-org/glm-5.3-flash` attempt through the existing Workers AI binding.
- Both models receive the same original image and book title, prompt, schema, confidence threshold, and Natural Earth city matching. No model-generated city coordinates are accepted.
- GLM uses `reasoning_effort: low`, JSON output, and a 10,000-token completion budget including reasoning. Primary/fallback deadlines are 30/45 seconds; the browser waits up to 90 seconds including the book read.
- Results and caches record the actual successful model. Cache version is `v3`, so old uncertain results cannot block the new fallback. A fallback service failure is not cached, including when the primary returned an uncertain geographic explanation.
- Logs contain model ID, result category, matched count, schema error paths, and duration. They contain no image, credentials, book title, or extracted labels.
- The waiting message and privacy page disclose Cloudflare-hosted GLM fallback processing. No additional key, infrastructure, database change, or dependency is needed.

## Defect found during real inference

The tested map has no printed date or map number. GLM returned `period: null` and `number: null`, which the earlier schema rejected, discarding otherwise usable recognition. Optional title/date/number now normalize missing or null values to an empty string. Invalid geography, labels, confidence, and country codes remain subject to the same validation.

## Acceptance

- Worker: TypeScript check and all 63 tests passed (22 atlas tests). Coverage includes primary success without fallback, confident non-map, provider/JSON/truncation/schema failures, uncertain region/city matching, correct model attribution and caching, retry after fallback failure, real AbortSignals for both deadlines, and null metadata.
- Web: build passed; lint has four existing warnings in unrelated files, no new warnings.
- Wrangler deployment dry run passed; the existing `AI` binding is present.
- Real provider test: the original `IMG_20250803_101111.jpg` from the user's book, 162,743 bytes, was sent to Cloudflare GLM. The local harness simulated only the primary failure; GLM inference was real. One response took approximately 39.6 seconds, used 2,135 input and 1,501 completion tokens, and read the title as 莫卧儿帝国. Replaying that same response after fixing nullable metadata produced 20 gazetteer-matched cities and 9 unresolved candidates. This checks model output and geographic matching, not independent correctness of every OCR label or image anchor.
- Evidence is outside the repository in the task artifact directory: `atlas-glm-raw-result.json`, `atlas-glm-grounded-result.json`, and `atlas-glm-evaluate.mjs`. No credentials are written to these artifacts.

## References

- https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/
- https://developers.cloudflare.com/workers-ai/features/json-mode/

## Production acceptance

- Deployed to `https://reader.example.workers.dev`, version `worker-version-id`.
- Live browser loaded `/assets/index-DGtYOunA.js`; the privacy page returned HTTP 200 and disclosed GLM fallback.
- The real map click exercised both production providers. DeepSeek returned invalid/missing `modernName` and `countryCode` fields for four candidate cities, rejected after 3,808 ms. GLM then succeeded through the production Workers AI binding in 28,841 ms.
- The endpoint returned HTTP 200 after 36,512 ms, `model: @cf/zai-org/glm-5.3-flash`, `cached: false`, map title 莫卧儿帝国, 19 matched cities and 11 unresolved names. The browser rendered the original alongside the interactive map. Counts differ from the earlier provider test because these are separate model responses; neither is a completeness or OCR-accuracy guarantee.
- Version and live response are saved in `atlas-glm-production-verification.json` outside the repository.
- Closing and reopening the same map returned `cached: true` with the GLM model attribution in 1,569 ms. Clicking 喀布尔 selected both the city marker and list entry, flew the camera to Kabul, and displayed an anchor on the original image. The narrow viewport layout was also visually checked.
