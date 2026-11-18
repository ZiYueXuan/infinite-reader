import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, makeEnv, mockFetch, parseSse, resetDb, setupReaderAgent, sseStream } from "./helpers";

beforeEach(resetDb);
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

describe("POST /api/ask", () => {
  it("requires authentication and ownership for admission, cancellation, and reconnection", async () => {
    const { te, client, bookId } = await setupReaderAgent();
    const noKey = new Client({ ...te, env: { ...te.env, DEEPSEEK_API_KEY: "" } as Env });
    noKey.cookie = client.cookie;
    expect((await noKey.fetch("/api/ask", { method: "POST", json: { bookId, question: "q" } })).status).toBe(503);
    expect((await new Client(makeEnv()).fetch("/api/ask", { method: "POST", json: { bookId, question: "q" } })).status).toBe(401);
    const other = new Client(te);
    await other.login("other@example.com");
    expect((await other.fetch("/api/ask", { method: "POST", json: { bookId, question: "q" } })).status).toBe(404);
    expect((await other.fetch("/api/ask/cancel", { method: "POST", json: { bookId, operationId: "x" } })).status).toBe(404);
    expect((await other.fetch('/api/ask/stream?bookId=' + bookId + '&operationId=x')).status).toBe(404);
    expect((await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "" } })).status).toBe(400);
  });

  it("reports provider errors in SSE and records each retry without invented usage", async () => {
    const { client, bookId } = await setupReaderAgent();
    const mock = mockFetch({ "https://llm.test/chat/completions": () => new Response("private provider error", { status: 500 }) });
    restore = mock.restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "q" } });
    const text = await response.text();
    expect(text).not.toContain("private provider error");
    expect(parseSse(text).at(-1)?.event).toBe("error");
    const calls = await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'ask'").all<any>();
    expect(calls.results).toHaveLength(2);
    expect(mock.calls).toHaveLength(2);
    for (const call of calls.results) expect(call).toMatchObject({ status: "failed", http_status: 500, input_tokens: null, usage_status: "unavailable", error_code: "llm_error" });
  });

  it("saves provider cache/reasoning usage without replacing missing values with zero", async () => {
    const { client, bookId } = await setupReaderAgent();
    const chunk = { id: "deepseek-stream-1", model: "deepseek-v4.1", choices: [{ finish_reason: "stop", delta: { content: "Answer" } }], usage: {
      prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 10 },
    } };
    restore = mockFetch({ "https://llm.test/chat/completions": () => new Response('data: ' + JSON.stringify(chunk) + '\n\n', { headers: { "content-type": "text/event-stream" } }) }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "q" } });
    expect(parseSse(await response.text()).at(-1)?.event).toBe("done");
    expect(await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'ask'").first()).toMatchObject({
      status: "succeeded", usage_status: "reported", input_tokens: 100, output_tokens: 30, total_tokens: 130,
      cached_input_tokens: 60, uncached_input_tokens: 40, reasoning_tokens: 10, provider_request_id: "deepseek-stream-1", response_model: "deepseek-v4.1",
    });
  });

  it("records incomplete streams as failures", async () => {
    const { client, bookId } = await setupReaderAgent();
    restore = mockFetch({ "https://llm.test/chat/completions": () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n') }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "q" } });
    expect(parseSse(await response.text()).at(-1)?.event).toBe("error");
    expect(await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'ask'").first()).toMatchObject({
      status: "failed", usage_status: "unavailable", input_tokens: null, output_tokens: null, total_tokens: null, error_code: "llm_stream_incomplete",
    });
  });

  it("records failed connection attempts with no provider response", async () => {
    const { client, bookId } = await setupReaderAgent();
    restore = mockFetch({ "https://llm.test/chat/completions": () => { throw new Error("private transport details"); } }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "q" } });
    const text = await response.text();
    expect(parseSse(text).at(-1)?.event).toBe("error");
    expect(text).not.toContain("private transport");
    expect(await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'ask'").first()).toMatchObject({
      status: "failed", usage_status: "unavailable", error_code: "llm_unreachable", http_status: null,
    });
  });

  it("keeps direct answers available for unindexed books and restricts model selection", async () => {
    const { client, bookId } = await setupReaderAgent();
    await env.DB.prepare("UPDATE books SET status = 'failed' WHERE id = ?").bind(bookId).run();
    const models: string[] = [];
    restore = mockFetch({ "https://llm.test/chat/completions": async req => {
      models.push((await req.json() as any).model);
      return sseStream(["Hello"]);
    } }).restore;
    const first = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "q", model: "deepseek-reasoner" } });
    expect(parseSse(await first.text()).filter(e => e.event === "meta").at(-1)?.data).toMatchObject({ retrieval: "skipped", citations: [] });
    await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "q", model: "not-allowed" } });
    expect(models).toEqual(["deepseek-reasoner", "deepseek-chat"]);
  });
});
