import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeUsage, startAiCall } from "../src/lib/aiUsage";
import { embedTexts } from "../src/pipeline";
import { makeEnv, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
const context = () => ({ operationId: crypto.randomUUID(), userId: null, bookId: null });
const callContext = () => ({ ...context(), feature: "ask" as const, provider: "deepseek" as const, model: "deepseek-chat" });
const row = (id: string) => env.DB.prepare("SELECT * FROM ai_usage WHERE id = ?").bind(id).first<Record<string, any>>();

describe("durable AI metering", () => {
  it("preserves provider usage and identity, without double-counting cumulative stream events", async () => {
    const call = await startAiCall(env, callContext());
    expect(await row(call.id)).toMatchObject({ status: "started", usage_status: "pending", total_tokens: null });
    call.observe({ id: "chat-123", model: "DeepSeek-V4.1-Flash-1017", usage: { prompt_tokens: 100, completion_tokens: 4 } });
    call.observe({ choices: [{ finish_reason: "stop" }], usage: {
      prompt_tokens: 100, completion_tokens: 40, total_tokens: 140,
      prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80,
      completion_tokens_details: { reasoning_tokens: 15 },
      prompt: "private prompt", response: "private response", nested: { secret: "private secret" },
    } });
    call.http(200);
    await Promise.all([call.finish({ status: "succeeded" }), call.finish({ status: "succeeded" })]);
    const saved = await row(call.id);
    expect(saved).toMatchObject({ status: "succeeded", usage_status: "reported", input_tokens: 100, output_tokens: 40,
      total_tokens: 140, cached_input_tokens: 20, uncached_input_tokens: 80, reasoning_tokens: 15,
      provider_request_id: "chat-123", response_model: "DeepSeek-V4.1-Flash-1017", finish_reason: "stop", http_status: 200 });
    expect(JSON.stringify(saved)).not.toContain("private");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM ai_usage").first<any>()).n).toBe(1);
  });

  it("keeps GLM cached-input and neuron metrics, including failed/truncated completions", async () => {
    const call = await startAiCall(env, { ...callContext(), provider: "cloudflare", model: "@cf/zai-org/glm-5.3-flash" });
    call.observe({ choices: [{ finish_reason: "length" }], usage: {
      prompt_tokens: 2135, completion_tokens: 1501, total_tokens: 3636,
      prompt_tokens_details: { cached_tokens: 0 }, neurons: 97.34091186523438,
    } });
    await call.finish({ status: "failed", errorCode: "atlas_invalid_result" });
    const saved = await row(call.id);
    expect(saved).toMatchObject({ status: "failed", usage_status: "reported", input_tokens: 2135,
      output_tokens: 1501, total_tokens: 3636, cached_input_tokens: 0, uncached_input_tokens: 2135, finish_reason: "length" });
    expect(JSON.parse(saved!.raw_usage).neurons).toBe(97.34091186523438);
  });

  it("distinguishes unknown, partial and explicitly zero usage; rejects invalid counters", async () => {
    expect(normalizeUsage({})).toMatchObject({ usage_status: "unavailable", input_tokens: null, output_tokens: null, total_tokens: null });
    expect(normalizeUsage({ input_tokens: 0, output_tokens: 0 })).toMatchObject({ usage_status: "reported", total_tokens: 0 });
    expect(normalizeUsage({ prompt_tokens: 12 })).toMatchObject({ usage_status: "partial", input_tokens: 12, total_tokens: null });
    expect(normalizeUsage({ search_requests: 1 })).toMatchObject({ usage_status: "partial", input_tokens: null, output_tokens: null, total_tokens: null });
    expect(normalizeUsage({ search_billable_requests: 0 })).toMatchObject({ usage_status: "partial", input_tokens: null, output_tokens: null });
    expect(normalizeUsage({ search_billable_requests: 1 })).toMatchObject({ usage_status: "partial" });
    expect(normalizeUsage({ search_billable_requests: -1 })).toMatchObject({ usage_status: "unavailable" });
    expect(normalizeUsage({ search_attempts: 1 })).toMatchObject({ usage_status: "unavailable", total_tokens: null });
    expect(normalizeUsage({ prompt_tokens: "12", completion_tokens: -1, total_tokens: Infinity })).toMatchObject({ usage_status: "unavailable" });
    expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } }).total_tokens).toBe(15);
  });

  it("records embedding successes, malformed output and provider failures as separate attempts", async () => {
    const te = makeEnv(), ctx = { ...context(), feature: "index_embedding" as const };
    const run = vi.fn().mockResolvedValueOnce({ data: [[1, 0]], usage: { input_tokens: 20 } })
      .mockResolvedValueOnce({ data: [], usage: { input_tokens: 7 } })
      .mockRejectedValueOnce(new Error("private upstream error"));
    te.env.AI = { run } as unknown as Env["AI"];
    expect(await embedTexts(te.env, ["private book text"], ctx)).toEqual([[1, 0]]);
    await expect(embedTexts(te.env, ["second"], ctx)).rejects.toThrow("unexpected shape");
    await expect(embedTexts(te.env, ["third"], ctx)).rejects.toThrow();
    const { results } = await env.DB.prepare("SELECT * FROM ai_usage ORDER BY started_at, rowid").all<any>();
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ status: "succeeded", input_tokens: 20, usage_status: "partial" });
    expect(results[1]).toMatchObject({ status: "failed", input_tokens: 7, error_code: "embedding_invalid_result" });
    expect(results[2]).toMatchObject({ status: "failed", input_tokens: null, usage_status: "unavailable", error_code: "embedding_upstream" });
    expect(JSON.stringify(results)).not.toContain("private");
  });

  it("does not call the provider when the initial ledger insert fails", async () => {
    const run = vi.fn();
    const te = makeEnv({ DB: { prepare: () => { throw new Error("D1 unavailable"); } }, AI: { run } });
    await expect(embedTexts(te.env, ["text"], { ...context(), feature: "retrieval_embedding" })).rejects.toMatchObject({ code: "ai_usage_unavailable" });
    expect(run).not.toHaveBeenCalled();
  });

  it("retries only the final ledger update and saves a recovery object on persistent D1 failure", async () => {
    let attempts = 0;
    const DB = { prepare: (sql: string) => {
      if (!sql.startsWith("UPDATE ai_usage")) return env.DB.prepare(sql);
      return { bind: () => ({ run: async () => { attempts++; throw new Error("D1 unavailable"); } }) };
    } } as D1Database;
    const call = await startAiCall({ DB, BOOKS: env.BOOKS }, callContext());
    call.observe({ usage: { prompt_tokens: 100, completion_tokens: 40 } });
    await call.finish({ status: "succeeded" });
    expect(attempts).toBe(2);
    expect(await row(call.id)).toMatchObject({ status: "started", usage_status: "pending" });
    const recovery = await env.BOOKS.get(`ai-usage-recovery/${call.id}.json`);
    expect(await recovery!.json()).toMatchObject({ id: call.id, status: "succeeded", input_tokens: 100, output_tokens: 40, total_tokens: 140 });
  });
});
