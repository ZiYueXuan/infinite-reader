import { env } from "cloudflare:workers";
import { abortAllDurableObjects, createExecutionContext, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { type Operation } from "../src/agent/protocol";
import { mockFetch, parseSse, resetDb, sseStream, setupReaderAgent as setup, toolStream } from "./helpers";

beforeEach(resetDb);
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

describe("Pi reader harness", () => {
  it("executes DSML-text calls through Pi and persists only the final answer", async () => {
    const { client, bookId } = await setup();
    const raw = '<｜DSML｜calls><｜DSML｜invoke name="read_book_passage"><｜DSML｜parameter name="chapter" string="false">1</｜DSML｜parameter><｜DSML｜parameter name="start" string="false">0</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>';
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": async req => {
      const body = await req.json() as any;
      if (++calls === 1) return sseStream([...( "I will read it.\n" + raw)]);
      expect(body.messages.find((m: any) => m.tool_calls).tool_calls[0].function).toMatchObject({ name: "read_book_passage", arguments: '{"chapter":1,"start":0}' });
      expect(JSON.stringify(body.messages.filter((m: any) => m.role === "assistant"))).not.toContain("DSML");
      expect(JSON.parse(body.messages.at(-1).content).passages[0].text).toContain("volcanoes");
      return sseStream(["The passage describes volcanoes [1]."]);
    } }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "Read this passage", operationId: "dsml-call" } });
    const rawEvents = await response.text(), events = parseSse(rawEvents);
    expect(rawEvents).not.toContain("DSML");
    expect(events.at(-1)?.event).toBe("done");
    expect(events.filter(e => e.event === "answer").at(-1)?.data.text).toBe("The passage describes volcanoes [1].");
    expect(calls).toBe(2);
    const history = await (await client.fetch(`/api/books/${bookId}/chat`)).json() as any;
    expect(history.messages.at(-1).content).toBe("The passage describes volcanoes [1].");
    const usage = await env.DB.prepare("SELECT status FROM ai_usage WHERE operation_id = 'dsml-call'").all<any>();
    expect(usage.results).toEqual([{ status: "succeeded" }, { status: "succeeded" }]);
  });

  it("resolves a selected section by EPUB path when the reader index differs", async () => {
    const { client, bookId } = await setup();
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": async req => {
      const body = await req.json() as any;
      if (++calls === 1) {
        expect(JSON.stringify(body.messages)).toContain("OEBPS/text/ch2.xhtml");
        return toolStream("read_book_passage", { chapter: 900, chapterHref: "OEBPS/text/ch2.xhtml", start: 0 });
      }
      const passage = JSON.parse(body.messages.at(-1).content).passages[0];
      expect(passage.chapter).toBe(1);
      expect(passage.text).toContain("volcanoes");
      return sseStream(["The selected section concerns volcanoes [1]."]);
    } }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "Explain this", readingPosition: { chapter: 900, start: 0, chapterHref: "OEBPS/text/ch2.xhtml", chapterTitle: "Section 901" } } });
    expect(parseSse(await response.text()).at(-1)?.event).toBe("done");
    expect(calls).toBe(2);
  });

  it("reports invalid tool markup as a failed response instead of a successful answer", async () => {
    const { client, bookId } = await setup();
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": () => { calls++; return sseStream(['Checking. <｜DSML｜calls><｜DSML｜invoke name="unknown">']); } }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "Read", operationId: "bad-protocol" } });
    const text = await response.text();
    expect(text).not.toContain("DSML");
    expect(parseSse(text).at(-1)).toMatchObject({ event: "error", data: { code: "llm_tool_protocol" } });
    expect(calls).toBe(1);
    expect(await env.DB.prepare("SELECT status, error_code FROM ai_usage WHERE operation_id = 'bad-protocol'").first()).toMatchObject({ status: "failed", error_code: "llm_tool_protocol" });
  });

  it("meters automatic context compaction through the same provider boundary", async () => {
    const { client, bookId, scope } = await setup();
    for (let i = 0; i < 10; i++) await env.DB.prepare("INSERT INTO chat_messages (id, book_id, user_id, thread_id, role, content, created_at) VALUES (?, ?, ?, 'default', ?, ?, ?)").bind(`legacy-${i}`, bookId, scope.userId, i % 2 ? "assistant" : "user", "Earlier discussion of the book. ".repeat(120), i).run();
    let calls = 0;
    const requests: any[] = [];
    restore = mockFetch({ "https://llm.test/chat/completions": async req => {
      requests.push(await req.json());
      calls++;
      // Keep enough recent text for Pi to select an older prefix without discarding the whole history.
      return sseStream([calls === 1 ? "Recent answer. ".repeat(1200) : calls === 2 ? "The earlier conversation discussed this book." : "Hello"], { prompt_tokens: calls === 1 ? 30_000 : 100, completion_tokens: 10 });
    } }).restore;
    await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "hello", operationId: "before-compaction" } });
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "hello again", operationId: "with-compaction" } });
    expect(parseSse(await response.text()).at(-1)?.event).toBe("done");
    expect(calls).toBe(3);
    expect(JSON.stringify(requests[1].messages)).toContain("<conversation>");
    expect(JSON.stringify(requests[2].messages)).toContain("The earlier conversation discussed this book.");
    const usage = await env.DB.prepare("SELECT * FROM ai_usage WHERE operation_id = 'with-compaction'").all<any>();
    expect(usage.results).toHaveLength(2);
    expect(usage.results.every(c => c.status === "succeeded" && c.input_tokens === 100 && c.output_tokens === 10)).toBe(true);
  });

  it("caps repeated model/tool rounds even if the provider ignores tool_choice none", async () => {
    const { client, bookId } = await setup();
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": () => toolStream("get_book_outline", {}, `repeat-${++calls}`) }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "loop", operationId: "bounded" } });
    expect(parseSse(await response.text()).at(-1)?.data.code).toBe("agent_budget_exhausted");
    expect(calls).toBe(6);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE operation_id = 'bounded'").first<{ n: number }>())?.n).toBe(6);
  });

  it("does not start a request if Stop arrived before admission", async () => {
    const { client, bookId } = await setup();
    const mock = mockFetch({ "https://llm.test/chat/completions": () => sseStream(["not expected"]) }); restore = mock.restore;
    await client.fetch("/api/ask/cancel", { method: "POST", json: { bookId, operationId: "cancel-first" } });
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "hello", operationId: "cancel-first" } });
    expect(response.status).toBe(409);
    expect(mock.calls).toHaveLength(0);
  });
  it("runs repeated search tools with stable citations and records every model and embedding call", async () => {
    const { client, bookId } = await setup();
    let turn = 0;
    const references: number[][] = [];
    restore = mockFetch({ "https://llm.test/chat/completions": async req => {
      const body = await req.json() as any;
      if (turn++ < 2) {
        if (turn === 2) {
          const assistant = body.messages.find((m: any) => m.tool_calls);
          expect(assistant.reasoning_content).toBe("Consult the book.");
          const passages = JSON.parse(body.messages.at(-1).content).passages;
          expect(passages[0].text).toContain("volcanoes");
          references.push(passages.map((p: any) => p.source));
        }
        return toolStream("search_book", { query: "volcanoes" }, `search-${turn}`);
      }
      references.push(JSON.parse(body.messages.at(-1).content).passages.map((p: any) => p.source));
      return sseStream(["The book describes volcanoes [1]."]);
    } }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "Describe the volcanoes", operationId: "search-twice" } });
    const events = parseSse(await response.text());
    expect(events.at(-1)?.event).toBe("done");
    expect(references[0]).toEqual(references[1]);
    const final = events.filter(e => e.event === "meta").at(-1)!.data;
    expect(final.citations).toHaveLength(1);
    expect(final.citations[0]).toMatchObject({ n: 1, chapterIndex: 1 });
    const calls = await env.DB.prepare("SELECT * FROM ai_usage WHERE operation_id = 'search-twice' ORDER BY started_at, rowid").all<any>();
    expect(calls.results.map(c => c.feature)).toEqual(["ask", "retrieval_embedding", "ask", "retrieval_embedding", "ask"]);
    expect(calls.results.filter(c => c.feature === "ask").every(c => c.input_tokens === 10 && c.output_tokens === 5)).toBe(true);
  });

  it("reads the outline and original passages without embeddings, retaining protocol history for follow-ups", async () => {
    const { client, bookId } = await setup();
    let turn = 0, followUp: any;
    restore = mockFetch({ "https://llm.test/chat/completions": async req => {
      const body = await req.json() as any;
      turn++;
      if (turn === 1) return toolStream("get_book_outline", {}, "outline");
      if (turn === 2) {
        expect(JSON.parse(body.messages.at(-1).content).chapters.map((c: any) => c.chapter)).toEqual([0, 1]);
        expect(JSON.parse(body.messages.at(-1).content).chapters[1].href).toContain("ch2.xhtml");
        return toolStream("read_book_passage", { chapter: 1, start: 0 }, "passage");
      }
      if (turn === 3) {
        expect(JSON.parse(body.messages.at(-1).content).passages[0].text).toContain("volcanoes");
        return sseStream(["Chapter Two discusses volcanoes [1]."]);
      }
      followUp = body.messages;
      return sseStream(["Yes, volcanoes [1]."]);
    } }).restore;
    await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "Read chapter two" } });
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "And what is its subject again?" } });
    expect(followUp.filter((m: any) => m.role === "tool")).toHaveLength(2);
    expect(followUp.filter((m: any) => m.tool_calls)).toHaveLength(2);
    expect(parseSse(await response.text()).filter(e => e.event === "meta").at(-1)?.data.citations[0].n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE feature = 'retrieval_embedding'").first<{ n: number }>())?.n).toBe(0);
  });

  it("replays completed operations after an instance restart without model calls or duplicate messages", async () => {
    const { client, bookId, inject } = await setup();
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": () => sseStream([`Answer ${++calls}`]) }).restore;
    const json = { bookId, question: "hello", operationId: "once" };
    await client.fetch("/api/ask", { method: "POST", json });
    await abortAllDurableObjects(); await inject();
    await client.fetch("/api/ask", { method: "POST", json: { ...json, question: "next", operationId: "next" } });
    const duplicate = await client.fetch("/api/ask", { method: "POST", json });
    expect(parseSse(await duplicate.text()).filter(e => e.event === "answer").at(-1)?.data.text).toBe("Answer 1");
    expect(calls).toBe(2);
    const history = await (await client.fetch(`/api/books/${bookId}/chat`)).json() as any;
    expect(history.messages).toHaveLength(4);
    expect((await client.fetch("/api/ask", { method: "POST", json: { ...json, question: "different" } })).status).toBe(409);
  });

  it("clears Pi context with chat history and starts a clean conversation", async () => {
    const { client, bookId, inject } = await setup();
    let seen: any[] = [];
    restore = mockFetch({ "https://llm.test/chat/completions": async req => { seen = (await req.json() as any).messages; return sseStream(["answer"]); } }).restore;
    await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "old private question" } });
    expect((await client.fetch(`/api/books/${bookId}/chat`, { method: "DELETE" })).status).toBe(200);
    const history = await (await client.fetch(`/api/books/${bookId}/chat`)).json() as any;
    expect(history.messages).toEqual([]);
    await inject();
    await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "new question" } });
    expect(JSON.stringify(seen)).not.toContain("old private question");
  });

  it("keeps a disconnected run resumable and cancels only through the explicit stop endpoint", async () => {
    const { client, te, bookId } = await setup();
    let signal: AbortSignal | undefined;
    restore = mockFetch({ "https://llm.test/chat/completions": req => {
      signal = req.signal;
      return new Response(new ReadableStream({ start(controller) {
        req.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      } }), { headers: { "content-type": "text/event-stream" } });
    } }).restore;
    const op = { bookId, operationId: "slow", threadId: "default" };
    const response = await app.fetch(new Request("https://reader.test/api/ask", { method: "POST", headers: { cookie: client.cookie, "content-type": "application/json" }, body: JSON.stringify({ ...op, question: "hello" }) }), te.env, createExecutionContext());
    const reader = response.body!.getReader();
    await reader.read();
    await expect.poll(() => !!signal).toBe(true);
    await reader.cancel();
    expect(signal!.aborted).toBe(false);
    expect((await (await client.fetch(`/api/books/${bookId}/chat`)).json() as any).pending.operationId).toBe("slow");
    expect((await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "busy" } })).status).toBe(409);
    expect((await client.fetch("/api/ask/cancel", { method: "POST", json: op })).status).toBe(200);
    expect(signal!.aborted).toBe(true);
    expect(await env.DB.prepare("SELECT * FROM ai_usage WHERE operation_id = 'slow'").first()).toMatchObject({ status: "aborted", input_tokens: null, error_code: "agent_cancelled" });
    const resumed = await client.fetch(`/api/ask/stream?bookId=${bookId}&operationId=slow`);
    expect(parseSse(await resumed.text()).at(-1)?.data.status).toBe("aborted");
  });

  it("does not call a provider for a recovered operation whose deadline has expired", async () => {
    const { client, bookId, stub, scope } = await setup();
    const mock = mockFetch({ "https://llm.test/chat/completions": () => sseStream(["should not run"]) }); restore = mock.restore;
    await runInDurableObject(stub, async (_instance, state) => {
      const op: Operation = { ...scope, id: "expired", userMessageId: "expired-u", messageId: "expired-a", request: { bookId, question: "late", operationId: "expired", threadId: "default", topK: 6 }, model: "deepseek-chat", startedAt: 1, deadline: 2, modelCalls: 0, toolCalls: 0, citationIds: [], retrieval: "skipped", status: "running", text: "" };
      await state.storage.put({ scope, active: "expired", "op:expired": op });
    });
    const response = await client.fetch(`/api/ask/stream?bookId=${bookId}&operationId=expired`);
    expect(parseSse(await response.text()).at(-1)?.data.code).toBe("agent_budget_exhausted");
    expect(mock.calls).toHaveLength(0);
  });
  it("answers directly without embedding, meters the actual request, and projects history", async () => {
    const { client, bookId } = await setup();
    restore = mockFetch({ "https://llm.test/chat/completions": async req => {
      const body = await req.json() as any;
      expect(body.tools.map((t: any) => t.function.name)).toEqual(["get_book_outline", "search_book", "read_book_passage"]);
      expect(body.stream_options.include_usage).toBe(true);
      expect(JSON.parse(body.messages.at(-1).content).readingPosition).toEqual({ epubSectionIndex: 3, characterOffset: 0, chapterTitle: "Chapter Two", chapterHref: "OEBPS/text/ch2.xhtml" });
      return sseStream(["Hello! ", "How can I help?"]);
    } }).restore;
    const response = await client.fetch("/api/ask", { method: "POST", json: { bookId, question: "Hello", operationId: "direct", readingPosition: { chapter: 3, start: 0, chapterTitle: "Chapter Two", chapterHref: "OEBPS/text/ch2.xhtml" } } });
    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    expect(events.at(-1)).toMatchObject({ event: "done", data: { status: "done" } });
    expect(events.filter(e => e.event === "answer").at(-1)?.data.text).toBe("Hello! How can I help?");
    expect(events.filter(e => e.event === "meta").at(-1)?.data.citations).toEqual([]);
    const { messages, pending } = await (await client.fetch(`/api/books/${bookId}/chat`)).json() as any;
    expect(pending).toBeNull();
    expect(messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1].content).toBe("Hello! How can I help?");
    const { results } = await env.DB.prepare("SELECT * FROM ai_usage WHERE operation_id = 'direct' ORDER BY started_at").all<any>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ feature: "ask", input_tokens: 10, output_tokens: 5, status: "succeeded", usage_status: "reported" });
  });
});
