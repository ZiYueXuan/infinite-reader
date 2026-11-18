import { createAssistantMessageEventStream, createProvider, resolveTranscriptTools, type AssistantMessage, type Model, type SimpleStreamOptions, type StreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import { startAiCall } from "../lib/aiUsage";
import { LIMITS, type Operation } from "./protocol";
import { normalizeToolProtocol } from "./toolProtocol";

export interface ModelHost {
  env: Env;
  beforeModel(): Promise<Operation>;
  modelFailure(code: string): Promise<void>;
}
const errorMessage = (model: Model<"openai-completions">, code: string): AssistantMessage => ({
  role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "error", errorMessage: code, timestamp: Date.now(),
});

/** Normalize provider wire quirks; Pi owns tool execution. Meter every actual attempt, including compaction. */
export function readerModelProvider(host: ModelHost) {
  const base = deepseekProvider().getModels()[0];
  const ids = new Set([host.env.DEEPSEEK_MODEL, ...host.env.DEEPSEEK_ALLOWED_MODELS.split(",").map(s => s.trim())]);
  const models: Model<"openai-completions">[] = [...ids].filter(Boolean).map(id => ({
    ...base, id, name: id, baseUrl: host.env.DEEPSEEK_BASE_URL.replace(/\/+$/, ""), input: ["text"],
    // A conservative application context budget also applies to older DeepSeek aliases.
    contextWindow: 32768, maxTokens: LIMITS.outputTokens,
    compat: { ...base.compat, supportsStrictMode: false, supportsFinishReason: true },
  }));
  const run = (model: Model<"openai-completions">, context: TranscriptContext, options: SimpleStreamOptions = {}) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      let call: Awaited<ReturnType<typeof startAiCall>> | undefined;
      let code = "llm_unreachable", terminal: AssistantMessage | undefined, status = 0;
      let signal = options.signal;
      try {
        const op = await host.beforeModel();
        signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.max(1, op.deadline - Date.now()))]);
        signal.throwIfAborted();
        call = await startAiCall(host.env, { operationId: op.id, userId: op.userId, bookId: op.bookId, feature: "ask", provider: "deepseek", model: model.id });
        const toolChoice = op.modelCalls >= 4 || op.toolCalls >= LIMITS.tools ? "none" : options.toolChoice;
        // Apply capability policy at the provider boundary as well as at execution. Old
        // tool declarations/history cannot re-enable search on a later ordinary turn.
        const webAllowed = op.webSearchAllowed === true;
        const scopedContext: TranscriptContext = { ...context, messages: [...context.messages, {
          role: 'system', timestamp: Date.now(),
          content: webAllowed ? 'Current-turn web search permission: enabled by the current user request. search_web uses DeepSeek and supports Chinese and multilingual queries now; earlier assistant claims that web access is unavailable or English-only are obsolete. Use the current tool declarations and policy.' : 'Current-turn web search permission: disabled. Do not call search_web or claim a new web search. A new explicit request is required.',
          ...(!webAllowed ? { toolsRemoved: [{ name: 'search_web' }] } : {}),
        }] };
        const events = completions.streamSimple(model, scopedContext, {
          ...options, signal, apiKey: host.env.DEEPSEEK_API_KEY,
          maxTokens: LIMITS.outputTokens, maxRetries: 0, timeoutMs: Math.max(1, op.deadline - Date.now()),
          // Leave room for a final response; the hard cap also counts retries and compaction.
          toolChoice,
          reasoning: model.id === "deepseek-reasoner" ? "high" : options.reasoning,
          fetch: async (input, init) => {
            const response = await globalThis.fetch(input, init);
            status = response.status;
            call!.http(status);
            return response;
          },
          onProviderStreamEvent: data => { call!.observe(data); },
        });
        for await (const event of normalizeToolProtocol(events, resolveTranscriptTools(scopedContext.messages, "none").requestTools, toolChoice !== "none")) {
          if (event.type === "done" || event.type === "error") {
            terminal = event.type === "done" ? event.message : event.error;
            code = signal.aborted ? "agent_cancelled" : status >= 400 ? "llm_error" : !status ? "llm_unreachable" : terminal.errorMessage === "llm_tool_protocol" ? "llm_tool_protocol" : terminal.errorMessage?.includes("finish_reason") ? "llm_stream_incomplete" : "llm_stream_failed";
            await call.finish({ status: event.type === "done" ? "succeeded" : signal.aborted ? "aborted" : "failed", errorCode: event.type === "done" ? undefined : code });
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
        code = error instanceof Error && /^(agent_budget_exhausted|agent_cancelled|book_unavailable|ai_usage_unavailable|llm_stream_incomplete)$/.test(error.message) ? error.message : signal?.aborted ? "agent_cancelled" : code;
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
  return createProvider({
    id: "deepseek", name: "DeepSeek", models,
    auth: { apiKey: { name: "Worker secret", resolve: async () => ({ auth: { apiKey: host.env.DEEPSEEK_API_KEY } }) } },
    api: {
      stream: (model, context, options?: StreamOptions) => run(model as Model<"openai-completions">, context, options),
      streamSimple: (model, context, options) => run(model as Model<"openai-completions">, context, options),
    },
  });
}
