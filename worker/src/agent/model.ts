import { createAssistantMessageEventStream, createModels, createProvider, normalizeContext, resolveTranscriptTools, type AssistantMessage, type Model, type SimpleStreamOptions, type StreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import { startAiCall } from "../lib/aiUsage";
import { HttpError } from "../lib/util";
import { compactionSource, completeSummaryText, summarizeHistory, SUMMARY_PROMPT } from "./historySummary";
import { LIMITS, type Operation } from "./protocol";
import { cleanAssistantHistory, normalizeToolProtocol } from "./toolProtocol";

export type ModelPurpose = "answer" | "summary";
export interface ModelHost {
  env: Env;
  beforeModel(purpose: ModelPurpose): Promise<Operation>;
  modelFailure(code: string): Promise<void>;
}
const errorMessage = (model: Model<"openai-completions">, code: string): AssistantMessage => ({
  role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "error", errorMessage: code, timestamp: Date.now(),
});

/** Normalize provider wire quirks; Pi owns tool execution. Meter every actual attempt, including compaction. */
export function readerModels(host: ModelHost, storage: DurableObjectStorage) {
  const base = deepseekProvider().getModels()[0];
  const ids = new Set([host.env.DEEPSEEK_MODEL, ...host.env.DEEPSEEK_ALLOWED_MODELS.split(",").map(s => s.trim())]);
  const models: Model<"openai-completions">[] = [...ids].filter(Boolean).map(id => ({
    ...base, id, name: id, baseUrl: host.env.DEEPSEEK_BASE_URL.replace(/\/+$/, ""), input: ["text"],
    // A conservative application context budget also applies to older DeepSeek aliases.
    contextWindow: 32768, maxTokens: Math.max(LIMITS.answerTokens, LIMITS.summaryTokens),
    compat: { ...base.compat, supportsStrictMode: false, supportsFinishReason: true },
  }));
  const run = (model: Model<"openai-completions">, context: TranscriptContext, options: SimpleStreamOptions = {}, purpose: ModelPurpose = "answer") => {
    const summary = purpose === "summary";
    const output = createAssistantMessageEventStream();
    void (async () => {
      let call: Awaited<ReturnType<typeof startAiCall>> | undefined;
      let code = "llm_unreachable", terminal: AssistantMessage | undefined, status = 0;
      let signal = options.signal;
      try {
        const op = await host.beforeModel(purpose);
        signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.max(1, op.deadline - Date.now()))]);
        signal.throwIfAborted();
        call = await startAiCall(host.env, { operationId: op.id, userId: op.userId, bookId: op.bookId, feature: summary ? "ask_summary" : "ask", provider: "deepseek", model: model.id });
        const answerCalls = op.modelCalls - (op.summaryCalls ?? 0);
        const canUseTools = answerCalls < 4 && op.modelCalls < LIMITS.modelCalls && op.toolCalls < LIMITS.tools;
        const toolChoice = summary ? undefined : canUseTools ? options.toolChoice : "none";
        // Apply capability policy at the provider boundary as well as at execution. Old
        // tool declarations/history cannot re-enable search on a later ordinary turn.
        const webAllowed = op.webSearchAllowed === true;
        const scopedContext: TranscriptContext = summary ? context : { ...context, messages: [...cleanAssistantHistory(context.messages), {
          role: 'system', timestamp: Date.now(),
          content: webAllowed ? 'Current-turn web search permission: enabled by the current user request. search_web uses DeepSeek and supports Chinese and multilingual queries now; earlier assistant claims that web access is unavailable or English-only are obsolete. Use the current tool declarations and policy.' : 'Current-turn web search permission: disabled. Do not call search_web or claim a new web search. A new explicit request is required.',
          ...(!webAllowed ? { toolsRemoved: [{ name: 'search_web' }] } : {}),
        }] };
        const events = completions.streamSimple(model, scopedContext, {
          ...options, signal, apiKey: host.env.DEEPSEEK_API_KEY,
          maxTokens: summary ? LIMITS.summaryTokens : LIMITS.answerTokens, maxRetries: 0, timeoutMs: Math.max(1, op.deadline - Date.now()),
          // Leave room for a final response; the hard cap also counts retries and compaction.
          toolChoice,
          reasoning: summary ? undefined : model.id === "deepseek-reasoner" ? "high" : options.reasoning,
          fetch: async (input, init) => {
            const response = await globalThis.fetch(input, init);
            status = response.status;
            call!.http(status);
            return response;
          },
          onProviderStreamEvent: data => { call!.observe(data); },
        });
        const responses = summary ? events : normalizeToolProtocol(events, resolveTranscriptTools(scopedContext.messages, "none").requestTools, toolChoice !== "none");
        for await (const event of responses) {
          if (event.type === "done" || event.type === "error") {
            terminal = event.type === "done" ? event.message : event.error;
            code = signal.aborted ? "agent_cancelled" : status >= 400 ? "llm_error" : !status ? "llm_unreachable" : terminal.errorMessage === "llm_tool_protocol" ? "llm_tool_protocol" : terminal.errorMessage?.includes("finish_reason") ? "llm_stream_incomplete" : "llm_stream_failed";
            const rejected = summary && event.type === "done" && !completeSummaryText(terminal);
            if (rejected) code = terminal.stopReason === "length" ? "summary_output_limit" : "summary_invalid";
            const succeeded = event.type === "done" && !rejected;
            await call.finish({ status: succeeded ? "succeeded" : signal.aborted ? "aborted" : "failed", errorCode: succeeded ? undefined : code });
            if (event.type === "error") {
              await host.modelFailure(code);
              // Never send provider error bodies (which can contain request details) to the UI.
              event.error.errorMessage = status >= 500 || status === 429 ? `HTTP ${status}: ${code}` : code === "llm_unreachable" ? `Network error: ${code}` : code;
            }
          }
          output.push(event);
        }
        if (!terminal) throw new Error("llm_stream_incomplete");
      } catch (error) {
        const reason = error instanceof HttpError ? error.code : error instanceof Error ? error.message : "";
        code = /^(agent_budget_exhausted|agent_cancelled|book_unavailable|ai_usage_unavailable|llm_stream_incomplete|history_summary_incomplete)$/.test(reason) ? reason : signal?.aborted ? "agent_cancelled" : code;
        try { await call?.finish({ status: signal?.aborted ? "aborted" : "failed", errorCode: code }); }
        catch { code = "ai_usage_unavailable"; }
        await host.modelFailure(code).catch(() => undefined);
        const message = terminal ?? errorMessage(model, code);
        message.stopReason = signal?.aborted ? "aborted" : "error";
        message.errorMessage = code;
        output.push({ type: "error", reason: message.stopReason, error: message });
      } finally { output.end(); }
    })();
    return output;
  };
  const registry = createModels();
  registry.setProvider(createProvider({
    id: "deepseek", name: "DeepSeek", models,
    auth: { apiKey: { name: "Worker secret", resolve: async () => ({ auth: { apiKey: host.env.DEEPSEEK_API_KEY } }) } },
    api: {
      stream: (model, context, options?: StreamOptions) => run(model as Model<"openai-completions">, context, options),
      streamSimple: (model, context, options) => run(model as Model<"openai-completions">, context, options),
    },
  }));
  // Pi 1.4 uses completeSimple for compaction and streamSimple for user-facing generations.
  // Keep Pi's range selection, durable retry and placement, including tasks already in flight at deploy.
  const complete = registry.completeSimple.bind(registry);
  registry.completeSimple = async (model, context, options) => {
    const source = compactionSource(context);
    if (!source || model.api !== "openai-completions") return complete(model, context, options);
    const readerModel = model as Model<"openai-completions">;
    const failure = errorMessage(readerModel, "history_summary_incomplete");
    let result: AssistantMessage;
    try {
      result = await summarizeHistory(storage, source.transcript, JSON.stringify([model.id, source.focus]), failure, options?.signal, (previousSummary, excerpt) => {
        const messages = normalizeContext({
          systemPrompt: SUMMARY_PROMPT,
          messages: [{ role: "user", timestamp: Date.now(), content: JSON.stringify({ previousSummary, excerpt, focus: source.focus }) }],
        });
        return run(readerModel, messages, options, "summary").result();
      });
    } catch {
      if (options?.signal?.aborted) { failure.stopReason = "aborted"; failure.errorMessage = "agent_cancelled"; }
      result = failure;
    }
    if (result.stopReason === "error" && !["book_unavailable", "ai_usage_unavailable", "agent_budget_exhausted"].includes(result.errorMessage ?? "")) {
      // Preserve the provider error on the Pi message so transient failures still use Pi's scheduled retry.
      await host.modelFailure("history_summary_incomplete");
    }
    return result;
  };
  return registry;
}
