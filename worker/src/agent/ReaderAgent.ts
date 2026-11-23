import { DurableObject } from "cloudflare:workers";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type AgentEvent, type EntryRecord } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { readerModels, type ModelPurpose } from "./model";
import { readingTools } from "./tools";
import { LIMITS, READER_PROMPT, messageIds, sse, userPrompt, type AskRequest, type Citation, type BookCitation, type WebCitation, type Operation, type Scope } from "./protocol";
import { requestsWebSearch } from './searchIntent';
import type { WebSource } from './webSearch';
import type { RetrievedChunk } from "../rag";
import { newId, sha256Hex } from "../lib/util";
import { visibleAnswer } from "../../../shared/agentText";

const textOf = (m?: AssistantMessage) => m?.content.filter(p => p.type === "text").map(p => p.text).join("") ?? "";
const failureText = (code?: string) => code === "agent_budget_exhausted"
  ? "This question reached the research limit. Please narrow the question or continue in a new message."
  : code === "history_summary_incomplete" ? "Conversation history could not be fully summarized. Send your question again to resume."
  : code === "book_unavailable" ? "This book is no longer available."
  : code === "ai_usage_unavailable" ? "AI usage could not be saved. Please try again later."
  : "The AI response was interrupted. Please try again.";

/** One user/book/thread owns one durable Pi conversation. D1 chat is a UI projection, never Pi's execution state. */
export class ReaderAgent extends DurableObject<Env> {
  private admission: Promise<unknown> = Promise.resolve();
  private cleared = false;
  private clearing = false;
  private pumps = new Set<Promise<void>>();
  private alarmWork?: Promise<void>;
  private createHarness() { return new PiHarness({
    defaults: { model: { provider: "deepseek", id: this.env.DEEPSEEK_MODEL }, thinkingLevel: "off" },
    harness: ({ storage, context, onWake }) => {
      const host = {
        env: this.env,
        operation: () => this.operation(), beforeTool: () => this.reserve("toolCalls"),
        beforeModel: (purpose: ModelPurpose) => this.reserve("modelCalls", purpose === "summary"),
        sources: (chunks: RetrievedChunk[]) => this.sources(chunks),
        reserveWebSearch: (query: string) => this.reserveWebSearch(query),
        webSources: (sources: WebSource[]) => this.webSources(sources),
        retrieval: (retrieval: Operation["retrieval"]) => this.update(op => { op.retrieval = retrieval; }),
        modelFailure: (code: string) => this.update(op => { op.errorCode = code; }),
      };
      const registry = createRegistry();
      registry.install({ name: "reader.instructions", sections: [{ key: "preamble", tag: false, render: () => READER_PROMPT }] });
      registry.install(readingTools(host));
      const models = readerModels(host, this.ctx.storage);
      return Harness.open(storage, {
        models, registry, onWake,
        settings: {
          toolExecution: "sequential", retry: { enabled: true, maxRetries: 1, baseDelayMs: 700 },
          stream: { maxRetries: 0 }, progress: { partialIntervalMs: 80 },
          compaction: { enabled: true, reserveTokens: 8192, keepRecentTokens: 4096, backgroundTokens: 0 },
        },
      }, context);
    },
  }); }
  private harness = this.createHarness();
  // Explicit handlers allow a clean runtime to be constructed after deleting chat storage.
  private lifecycle = new Lifecycle(this).use(this.harness);

  async alarm() {
    if (this.clearing || this.cleared) return;
    this.alarmWork = this.lifecycle.alarm();
    try { await this.alarmWork; } finally { this.alarmWork = undefined; }
  }

  private async authorized() {
    const scope = await this.ctx.storage.get<Scope>("scope");
    if (!scope || !await this.env.DB.prepare("SELECT id FROM books WHERE id = ? AND user_id = ? AND status != 'deleting'").bind(scope.bookId, scope.userId).first()) throw new Error("book_unavailable");
    return scope;
  }
  private async operation() {
    const id = await this.ctx.storage.get<string>("active");
    const op = id ? await this.ctx.storage.get<Operation>(`op:${id}`) : undefined;
    if (!op) throw new Error("agent_cancelled");
    return op;
  }
  private async update(change: (op: Operation) => void) {
    await this.ctx.storage.transaction(async tx => {
      const id = await tx.get<string>("active");
      const op = id ? await tx.get<Operation>(`op:${id}`) : undefined;
      if (!op) throw new Error("agent_cancelled");
      change(op);
      await tx.put(`op:${id}`, op);
    });
  }
  private async reserve(kind: "modelCalls" | "toolCalls", summary = false) {
    await this.authorized();
    await this.update(op => {
      if (op.status !== "running") throw new Error("agent_cancelled");
      if (Date.now() >= op.deadline || op[kind] >= (kind === "modelCalls" ? LIMITS.modelCalls : LIMITS.tools)) throw new Error("agent_budget_exhausted");
      if (summary && op.modelCalls >= LIMITS.modelCalls - 1) throw new Error("history_summary_incomplete");
      op[kind]++;
      if (summary) op.summaryCalls = (op.summaryCalls ?? 0) + 1;
    });
    return this.operation();
  }
  private async sources(chunks: RetrievedChunk[]) {
    return this.ctx.storage.transaction(async tx => {
      let count = await tx.get<number>("source-count") ?? 0;
      const id = await tx.get<string>("active");
      const op = await tx.get<Operation>(`op:${id}`);
      if (!op || op.status !== "running") throw new Error("agent_cancelled");
      const selected: BookCitation[] = [];
      for (const c of chunks) {
        const key = `source:${c.id}:${c.charStart}:${c.charEnd}`;
        let citation = await tx.get<BookCitation>(key);
        if (!citation) {
          citation = { n: ++count, chunkId: c.id, ordinal: c.ordinal, chapterIndex: c.chapterIndex, chapterTitle: c.chapterTitle, chapterHref: c.chapterHref, charStart: c.charStart, charEnd: c.charEnd, snippet: c.text.slice(0, 240), score: c.score };
          await tx.put({ [key]: citation, [`citation:${citation.n}`]: citation });
        }
        if (!op.citationIds.includes(citation.n)) op.citationIds.push(citation.n);
        selected.push(citation);
      }
      await tx.put({ "source-count": count, [`op:${id}`]: op });
      return selected;
    });
  }
  private async reserveWebSearch(query: string) {
    await this.authorized();
    await this.update(op => {
      if (op.status !== 'running' || Date.now() >= op.deadline) throw new Error('agent_cancelled');
      if (!op.webSearchAllowed || !requestsWebSearch(op.request.question)) throw new Error('web_search_not_authorized');
      const queries = op.webSearchQueries ??= [];
      const normalized = query.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!normalized) throw new Error('web_search_unavailable');
      if (queries.includes(normalized)) throw new Error('web_search_duplicate');
      if (queries.length >= LIMITS.webSearches) throw new Error('web_search_budget');
      // Reserve durably before dispatch so replay cannot silently bill the same query again.
      queries.push(normalized);
    });
    return this.operation();
  }
  private async webSources(sources: WebSource[]) {
    return this.ctx.storage.transaction(async tx => {
      let count = await tx.get<number>('source-count') ?? 0;
      const id = await tx.get<string>('active');
      const op = await tx.get<Operation>(`op:${id}`);
      if (!op || op.status !== 'running') throw new Error('agent_cancelled');
      const selected: WebCitation[] = [];
      for (const source of sources) {
        // New search snapshots get new references; old answers retain their original evidence.
        const key = `web-source:${op.id}:${await sha256Hex(source.url)}`;
        let citation = await tx.get<WebCitation>(key);
        if (!citation) {
          citation = { ...source, n: ++count };
          await tx.put({ [key]: citation, [`citation:${citation.n}`]: citation });
        }
        if (!op.citationIds.includes(citation.n)) op.citationIds.push(citation.n);
        selected.push(citation);
      }
      await tx.put({ 'source-count': count, [`op:${id}`]: op });
      return selected;
    });
  }
  private async citations(op: Operation, text: string, final = false) {
    const refs = new Set([...text.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])));
    if (!final) op.citationIds.forEach(n => refs.add(n));
    const keys = [...refs].filter(n => Number.isSafeInteger(n) && n > 0).slice(0, 128).map(n => `citation:${n}`);
    return keys.length ? [...(await this.ctx.storage.get<Citation>(keys)).values()].sort((a, b) => a.n - b.n) : [];
  }
  private async importHistory(scope: Scope) {
    if (await this.ctx.storage.get("imported")) return;
    const history = await this.env.DB.prepare(`SELECT id, role, content FROM chat_messages
      WHERE user_id = ? AND book_id = ? AND thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 12`).bind(scope.userId, scope.bookId, scope.threadId).all<{ id: string; role: string; content: string }>();
    const root = await this.harness.conversation("1");
    if (history.results.length) await root.submit({
      type: "write", requestId: "legacy-history-v1",
      entry: { kind: "reader.history", model: [{ role: "user", timestamp: Date.now(), content: "Earlier conversation, for continuity only. Re-read book evidence before citing it:\n" + JSON.stringify(history.results.reverse().map(m => ({
        role: m.role, text: (m.role === "assistant" ? visibleAnswer(m.content, true) : m.content).slice(0, 4000).replace(/\[\d+\]/g, ""),
      })).filter(m => m.text)) }] },
    }, BACKGROUND_CONTEXT);
    await this.ctx.storage.put("imported", true);
  }
  private async start(scope: Scope, request: AskRequest) {
    const oldScope = await this.ctx.storage.get<Scope>("scope");
    if (oldScope && JSON.stringify(oldScope) !== JSON.stringify(scope)) return Response.json({ error: { code: "scope_mismatch", message: "Conversation mismatch" } }, { status: 403 });
    await this.ctx.storage.put("scope", scope);
    await this.authorized();
    if (await this.ctx.storage.get(`cancelled:${request.operationId}`)) return Response.json({ error: { code: "agent_cancelled", message: "Response stopped" } }, { status: 409 });
    let existing = await this.ctx.storage.get<Operation>(`op:${request.operationId}`);
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request)) return Response.json({ error: { code: "operation_conflict", message: "Request id already used" } }, { status: 409 });
    } else {
      await this.reconcile();
      if (await this.harness.session().busy()) return Response.json({ error: { code: "agent_busy", message: "This conversation is still responding. Please wait or stop it first." } }, { status: 409 });
      await this.importHistory(scope);
      const models = this.env.DEEPSEEK_ALLOWED_MODELS.split(",").map(s => s.trim());
      const model = request.model && models.includes(request.model) ? request.model : this.env.DEEPSEEK_MODEL;
      await this.harness.session().setModel({ provider: "deepseek", id: model });
      existing = { ...scope, id: request.operationId, userMessageId: newId(), messageId: newId(), request, model, startedAt: Date.now(), deadline: Date.now() + LIMITS.durationMs, modelCalls: 0, toolCalls: 0, citationIds: [], retrieval: "skipped", status: "running", text: "" };
      existing.webSearchAllowed = requestsWebSearch(request.question);
      await this.ctx.storage.put({ active: existing.id, [`op:${existing.id}`]: existing });
    }
    const op = existing;
    if (op.status === "running") {
      await this.ensureSubmitted(op);
    }
    return this.stream(op.id);
  }
  private async ensureSubmitted(op: Operation) {
    if (op.submitted || op.status !== "running") return;
    // Both writes are idempotent, including a crash between admission and Pi's durable receipt.
    await this.env.DB.prepare(`INSERT OR IGNORE INTO chat_messages (id, book_id, user_id, thread_id, role, content, selection, created_at)
      VALUES (?, ?, ?, ?, 'user', ?, ?, ?)`).bind(op.userMessageId, op.bookId, op.userId, op.threadId, op.request.question, op.request.selection ? JSON.stringify(op.request.selection) : null, op.startedAt).run();
    if (Date.now() >= op.deadline) {
      await this.update(o => { o.status = "error"; o.errorCode = "agent_budget_exhausted"; });
      return;
    }
    await this.harness.submit(userPrompt(op.request), { operationId: op.id, entry: { kind: "reader.question", data: { operationId: op.id } } });
    await this.update(o => { o.submitted = true; });
  }
  private async finish(id: string) {
    let op = await this.ctx.storage.get<Operation>(`op:${id}`);
    if (!op) return;
    if (op.status === "running") {
      await this.ensureSubmitted(op);
      op = (await this.ctx.storage.get<Operation>(`op:${id}`))!;
    }
    if (op.status === "running") {
      const result = await this.harness.wait(id);
      op = (await this.ctx.storage.get<Operation>(`op:${id}`))!;
      if (!op || this.clearing) return;
      op.status = result.status === "done" ? "done" : result.reason === "aborted" ? "aborted" : "error";
      if (op.errorCode === "agent_budget_exhausted") op.status = "error";
      op.text = result.text ?? op.text;
      if (op.status === "done") delete op.errorCode;
      await this.ctx.storage.put(`op:${id}`, op);
    }
    if (this.clearing || op.projected) return;
    if (op.text) await this.env.DB.prepare(`INSERT INTO chat_messages (id, book_id, user_id, thread_id, role, content, citations, model, created_at)
      VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, citations = excluded.citations`).bind(
      messageIds(op).messageId, op.bookId, op.userId, op.threadId, op.text, JSON.stringify(await this.citations(op, op.text, true)), op.model, op.startedAt + 1,
    ).run();
    op.projected = true;
    await this.ctx.storage.put(`op:${id}`, op);
  }
  private async reconcile() {
    const id = await this.ctx.storage.get<string>("active");
    if (!id) return;
    const op = await this.ctx.storage.get<Operation>(`op:${id}`);
    if (!op) return;
    await this.ensureSubmitted(op);
    if (op.status === "running" && Date.now() >= op.deadline) {
      await this.update(o => { o.errorCode = "agent_budget_exhausted"; });
      await this.harness.abort({ operationId: id });
    }
    if (!await this.harness.session().busy()) await this.finish(id);
  }

  private async stream(id: string) {
    const op = await this.ctx.storage.get<Operation>(`op:${id}`);
    if (!op) return new Response("Not found", { status: 404 });
    let closed = false;
    let stop = async () => {};
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        const send = (name: string, value: unknown) => { if (!closed) controller.enqueue(sse(name, value)); };
        const sendFinal = async (done: Operation) => {
          const text = visibleAnswer(done.text, true);
          send("meta", { ...messageIds(done), operationId: id, model: done.model, retrieval: done.retrieval, citations: await this.citations(done, text, true) });
          send("answer", { text });
          if (text !== done.text) send("error", { code: "llm_tool_protocol", message: failureText("llm_tool_protocol") });
          else if (done.status === "error") send("error", { code: done.errorCode ?? "agent_failed", message: failureText(done.errorCode) });
          else send("done", { ...messageIds(done), operationId: id, status: done.status });
        };
        const pump = async () => {
          if (op.status !== "running") { await this.finish(id); await sendFinal(op); return; }
          const view = new AnswerView(id);
          const events = await this.harness.session().events();
          stop = async () => { await events.stop(); };
          let text = op.text;
          const render = async (batch: readonly AgentEvent[]) => {
            for (const event of batch) view.apply(event);
            text = view.text;
            const latest = await this.ctx.storage.get<Operation>(`op:${id}`) ?? op;
            send("meta", { ...messageIds(op), operationId: id, model: op.model, retrieval: latest.retrieval, citations: await this.citations(latest, text) });
            send("answer", { text });
            const tool = batch.find(e => e.type === "tool_execution_start");
            if (tool?.type === "tool_execution_start") send("tool", { name: tool.toolName });
          };
          try {
            await render([events.snapshot]);
            events.start(async batch => { if (!closed) await render(batch); });
            const timer = setTimeout(() => {
              void this.update(o => { o.errorCode = "agent_budget_exhausted"; }).then(() => this.harness.abort({ operationId: id }));
            }, Math.max(1, op.deadline - Date.now()));
            try { await this.finish(id); } finally { clearTimeout(timer); }
            const done = await this.ctx.storage.get<Operation>(`op:${id}`) ?? op;
            if (!done.text && text) {
              done.text = text;
              done.projected = false;
              await this.ctx.storage.put(`op:${id}`, done);
              await this.finish(id);
            }
            await events.stop();
            await sendFinal(done);
          } finally { await events.stop(); }
        };
        const work = pump().catch(() => send("error", { code: "agent_failed", message: failureText() })).finally(() => { if (!closed) { closed = true; controller.close(); } });
        this.pumps.add(work);
        this.ctx.waitUntil(work.finally(() => { this.pumps.delete(work); }));
      },
      cancel: async () => { closed = true; await stop(); },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform" } });
  }
  async fetch(request: Request): Promise<Response> {
    // Serialize lifecycle reset with admission, including requests already queued during Clear.
    const job = this.admission.then(() => this.handle(request));
    this.admission = job.catch(() => undefined);
    return job;
  }
  private async handle(request: Request): Promise<Response> {
    if (this.cleared) {
      this.harness = this.createHarness();
      this.lifecycle = new Lifecycle(this).use(this.harness);
      this.cleared = false; this.clearing = false;
    }
    if (this.clearing) return new Response("Conversation is being cleared", { status: 503 });
    await this.lifecycle.start();
    const url = new URL(request.url);
    if (url.pathname === "/start") {
      const { scope, input } = await request.json<{ scope: Scope; input: AskRequest }>();
      return this.start(scope, input);
    }
    if (url.pathname === "/clear") {
        this.clearing = true;
        const scope = await this.ctx.storage.get<Scope>("scope");
        await this.lifecycle.disableAlarms();
        await this.harness.abort();
        await Promise.allSettled(this.pumps);
        await this.lifecycle.dispose();
        await this.alarmWork;
        if (scope) await this.env.DB.prepare("DELETE FROM chat_messages WHERE user_id = ? AND book_id = ? AND thread_id = ?").bind(scope.userId, scope.bookId, scope.threadId).run();
        await this.ctx.storage.deleteAll(); this.cleared = true;
        return Response.json({ ok: true });
    }
    if (url.pathname === "/cancel") {
      const { operationId } = await request.json<{ operationId: string }>();
        const op = await this.ctx.storage.get<Operation>(`op:${operationId}`);
        if (!op) {
          // Stop may reach the object before the original POST. Do not admit it later.
          await this.ctx.storage.put(`cancelled:${operationId}`, true);
        } else {
          await this.authorized();
          if (!op.submitted && op.status === "running") {
            op.status = "aborted";
            await this.ctx.storage.put(`op:${operationId}`, op);
          }
          await this.harness.abort({ operationId }); await this.finish(operationId);
        }
        return Response.json({ ok: true });
    }
    if (!await this.ctx.storage.get("scope")) return Response.json({ pending: null });
    await this.authorized();
    await this.reconcile();
    if (url.pathname === "/stream") return this.stream(url.searchParams.get("operationId") ?? "");
    const op = await this.operation().catch(() => undefined);
    return Response.json({ pending: op?.status === "running" ? { operationId: op.id, ...messageIds(op) } : null });
  }
}

/** Rebuild the visible answer from Pi commits; snapshots also repair dropped batches and reconnects. */
class AnswerView {
  private active = false;
  private message?: AssistantMessage;
  private committed = "";
  constructor(private id: string) {}
  get text() { return this.message ? visibleAnswer(textOf(this.message)) : visibleAnswer(this.committed, true); }
  private entry(entry: EntryRecord) {
    if (entry.kind === "reader.question") {
      this.active = (entry.data as { operationId?: string } | undefined)?.operationId === this.id;
      if (this.active) { this.committed = ""; this.message = undefined; }
    }
    if (!this.active) return;
    const m = entry.model?.find(m => m.role === "assistant");
    if (m?.role === "assistant") { this.committed = textOf(m); this.message = undefined; }
  }
  apply(event: AgentEvent) {
    if (event.type === "snapshot") {
      this.active = false; this.message = undefined; this.committed = "";
      event.entries.forEach(e => this.entry(e));
      if (this.active && event.generation?.message) this.message = structuredClone(event.generation.message);
    } else if (event.type === "entry_appended" || event.type === "message_end") this.entry(event.entry);
    else if (this.active && event.type === "message_start" && event.message.role === "assistant") this.message = structuredClone(event.message);
    else if (this.active && event.type === "message_update" && this.message) {
      for (const change of event.changes) {
        if (change.type === "message") this.message = structuredClone(change.message);
        else if ("block" in change) this.message.content[change.contentIndex] = structuredClone(change.block);
        else if (change.type === "text_delta") {
          const block = this.message.content[change.contentIndex];
          if (block?.type === "text") block.text += change.delta;
        }
      }
    }
  }
}
