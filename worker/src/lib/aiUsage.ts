import { HttpError, newId, now } from "./util";

export interface AiUsageContext {
  operationId: string;
  userId: string | null;
  bookId: string | null;
}
export interface AiCallContext extends AiUsageContext {
  feature: "chapter_slides" | "booklist" | "mindmap" | "highlight_mindmap" | "atlas_primary" | "atlas_fallback" | "text_atlas" | "ask" | "web_search" | "index_embedding" | "retrieval_embedding";
  provider: "deepseek" | "cloudflare";
  model: string;
  inputCharacters?: number;
}
type Outcome = { status: "succeeded" | "failed" | "aborted"; errorCode?: string };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const token = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
// Only provider identifiers, not arbitrary upstream messages, may enter the ledger.
const identifier = (value: unknown): string | null => typeof value === "string" && /^[\w@./:+-]{1,200}$/.test(value) ? value : null;

/** Preserve numeric usage extensions (e.g. image tokens / neurons), never arbitrary response text. */
function numericUsage(value: unknown, depth = 0): ObjectValue {
  if (depth > 3) return {};
  const result: ObjectValue = {};
  for (const [key, item] of Object.entries(object(value)).slice(0, 40)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)) continue;
    if (typeof item === "number" && Number.isFinite(item) && item >= 0) result[key] = item;
    else if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = numericUsage(item, depth + 1);
      if (Object.keys(nested).length) result[key] = nested;
    }
  }
  return result;
}

export function normalizeUsage(raw: ObjectValue) {
  const inputDetails = object(raw.prompt_tokens_details ?? raw.input_tokens_details);
  const outputDetails = object(raw.completion_tokens_details ?? raw.output_tokens_details);
  const cached = token(raw.prompt_cache_hit_tokens) ?? token(inputDetails.cached_tokens);
  const reportedMiss = token(raw.prompt_cache_miss_tokens);
  const input = token(raw.prompt_tokens) ?? token(raw.input_tokens)
    ?? (cached !== null && reportedMiss !== null ? cached + reportedMiss : null);
  const output = token(raw.completion_tokens) ?? token(raw.output_tokens);
  const total = token(raw.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  const uncached = reportedMiss ?? (input !== null && cached !== null && cached <= input ? input - cached : null);
  const reasoning = token(outputDetails.reasoning_tokens);
  const anyTokens = [input, output, total, cached, uncached, reasoning].some((value) => value !== null);
  return {
    input_tokens: input, output_tokens: output, total_tokens: total,
    cached_input_tokens: cached, uncached_input_tokens: uncached, reasoning_tokens: reasoning,
    // A search response counter is application-observed usage, not token usage or a billing receipt.
    usage_status: input !== null && output !== null ? "reported" : anyTokens || raw.search_requests === 1 || raw.search_billable_requests === 0 || raw.search_billable_requests === 1 ? "partial" : "unavailable",
  };
}

/** Start durably before making a paid request; a storage outage must not create untracked calls. */
export async function startAiCall(env: Pick<Env, "DB" | "BOOKS">, context: AiCallContext) {
  const id = newId(), startedAt = now();
  try {
    await env.DB.prepare(`INSERT INTO ai_usage
      (id, operation_id, user_id, book_id, feature, provider, requested_model, started_at, input_characters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, context.operationId, context.userId, context.bookId, context.feature, context.provider, context.model, startedAt, context.inputCharacters ?? null,
      ).run();
  } catch {
    throw new HttpError(503, "ai_usage_unavailable", "AI usage storage is temporarily unavailable");
  }
  let raw: ObjectValue = {}, responseModel: string | null = null, requestId: string | null = null;
  let finishReason: string | null = null, httpStatus: number | null = null;
  let finalizing: Promise<void> | undefined;
  return {
    id,
    http(status: number) { httpStatus = status; },
    observe(envelope: unknown) {
      const data = object(envelope);
      responseModel = identifier(data.model) ?? responseModel;
      requestId = identifier(data.id) ?? requestId;
      const choice = object(Array.isArray(data.choices) ? data.choices[0] : undefined);
      finishReason = identifier(choice.finish_reason) ?? finishReason;
      // Streaming usage is cumulative. Merge snapshots; never add their totals together.
      const incoming = numericUsage(data.usage);
      for (const [key, value] of Object.entries(incoming)) {
        raw[key] = typeof value === "object" ? { ...object(raw[key]), ...object(value) } : value;
      }
    },
    finish(outcome: Outcome): Promise<void> {
      return finalizing ??= (async () => {
        const finishedAt = now();
        const values = {
          ...normalizeUsage(raw), response_model: responseModel, provider_request_id: requestId,
          raw_usage: Object.keys(raw).length ? JSON.stringify(raw) : null,
          finish_reason: finishReason, http_status: httpStatus, status: outcome.status,
          error_code: outcome.errorCode ?? null, finished_at: finishedAt, duration_ms: Math.max(0, finishedAt - startedAt),
        };
        // The same row is updated on retry, so a transient D1 error cannot double-count tokens.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await env.DB.prepare(`UPDATE ai_usage SET ${Object.keys(values).map((key) => `${key} = ?`).join(", ")} WHERE id = ?`)
              .bind(...Object.values(values), id).run();
            if (result.meta.changes === 1) return;
          } catch { /* Retry only persistence, never the paid inference. */ }
        }
        // Preserve the exact metering result if D1 is temporarily unavailable after inference.
        // The pending D1 row and this recovery object share an id for idempotent reconciliation.
        try {
          await env.BOOKS.put(`ai-usage-recovery/${id}.json`, JSON.stringify({ id, ...values }), {
            httpMetadata: { contentType: "application/json" },
          });
        } catch {
          console.error(JSON.stringify({ message: "AI usage persistence failed", usageId: id }));
          throw new HttpError(503, "ai_usage_unavailable", "AI usage storage is temporarily unavailable");
        }
        console.error(JSON.stringify({ message: "AI usage needs D1 reconciliation", usageId: id }));
      })();
    },
  };
}
