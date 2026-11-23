import { validateToolCall, type AssistantMessage, type AssistantMessageEvent, type Message, type Tool, type ToolCall } from "@earendil-works/pi-ai";

import { toolProtocolStart, visibleAnswer } from "../../../shared/agentText";

const protocolError = () => new Error("llm_tool_protocol");

function clean(message: AssistantMessage, final = false): AssistantMessage {
  const copy = structuredClone(message);
  for (const block of copy.content) if (block.type === "text") block.text = visibleAnswer(block.text, final);
  return copy;
}

/** An old reply saved as tool markup must not become an example for the next turn. */
export function cleanAssistantHistory(messages: Message[]): Message[] {
  return messages.flatMap<Message>(message => {
    if (message.role !== "assistant" || !message.content.some(b => b.type === "text" && toolProtocolStart(b.text) >= 0)) return [message];
    const assistant = clean(message, true);
    return assistant.content.some(b => b.type === "toolCall" || (b.type === "text" && b.text.trim())) ? [assistant] : [];
  });
}

/** Decode only a complete top-level DSML calls envelope from this model response.
 * It becomes ordinary Pi tool calls, so authorization, validation and tool budgets
 * still apply. Never interpret user messages, tool results or saved chat as calls.
 */
function recover(message: AssistantMessage, tools: Tool[], allowed: boolean): AssistantMessage {
  const result = clean(message, true);
  const blocks = message.content.filter(b => b.type === "text" && toolProtocolStart(b.text) >= 0);
  if (!blocks.length) return result;
  if (!allowed || blocks.length !== 1 || message.stopReason === "length" || message.content.some(b => b.type === "toolCall")) throw protocolError();
  const text = blocks[0].type === "text" ? blocks[0].text : "";
  const at = toolProtocolStart(text);
  const prefix = text.slice(0, at).trimEnd();
  // A quoted/code example is not an executable tool request.
  if (prefix.includes("`") || prefix.split("\n").at(-1)?.trimStart().startsWith(">")) throw protocolError();
  let rest = text.slice(at);
  const opener = /^<(｜{1,2}|\|{1,2})DSML\1[ \t]*calls>/.exec(rest);
  if (!opener) throw protocolError();
  // Match the same delimiter throughout the envelope. Only tag syntax is normalized.
  const bars = opener[1].replaceAll("|", "\\|");
  const ns = `${bars}DSML${bars}[ \\t]*`;
  const invoke = new RegExp(`^<${ns}invoke name="([\\w-]+)">`);
  const parameter = new RegExp(`^<${ns}parameter name="([\\w-]+)" string="(true|false)">`);
  const endParameter = new RegExp(`</${ns}parameter>`);
  const endInvoke = new RegExp(`^</${ns}invoke>`);
  const endCalls = new RegExp(`^</${ns}calls>`);
  rest = rest.slice(opener[0].length).trimStart();
  const take = (pattern: RegExp, trim = true) => {
    const match = pattern.exec(rest);
    if (!match) throw protocolError();
    rest = rest.slice(match[0].length);
    if (trim) rest = rest.trimStart();
    return match;
  };
  const calls: ToolCall[] = [];
  while (!endCalls.test(rest)) {
    if (calls.length >= 8) throw protocolError();
    const [, name] = take(invoke);
    const args: ToolCall["arguments"] = {};
    while (!endInvoke.test(rest)) {
      const [, key, string] = take(parameter, false);
      if (["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(args, key)) throw protocolError();
      const end = endParameter.exec(rest);
      if (!end) throw protocolError();
      const value = rest.slice(0, end.index);
      try { args[key] = string === "true" ? value : JSON.parse(value); } catch { throw protocolError(); }
      rest = rest.slice(end.index + end[0].length).trimStart();
    }
    take(endInvoke);
    const call: ToolCall = { type: "toolCall", id: `dsml_${crypto.randomUUID().replaceAll("-", "")}`, name, arguments: args };
    try { call.arguments = validateToolCall(tools, call); } catch { throw protocolError(); }
    calls.push(call);
  }
  take(endCalls);
  if (rest.trim() || !calls.length) throw protocolError();
  result.content.push(...calls);
  result.stopReason = "toolUse";
  return result;
}

/** Preserve ordinary streaming while withholding protocol syntax across chunk boundaries. */
export async function* normalizeToolProtocol(events: AsyncIterable<AssistantMessageEvent>, tools: Tool[], allowed: boolean): AsyncGenerator<AssistantMessageEvent> {
  const emitted = new Map<number, string>();
  for await (const event of events) {
    if (event.type === "done") {
      let message: AssistantMessage;
      try { message = recover(event.message, tools, allowed); }
      catch {
        const error = clean(event.message);
        error.stopReason = "error"; error.errorMessage = "llm_tool_protocol";
        yield { type: "error", reason: "error", error };
        return;
      }
      for (let i = event.message.content.length; i < message.content.length; i++) {
        const toolCall = message.content[i] as ToolCall;
        yield { type: "toolcall_start", contentIndex: i, partial: message };
        yield { type: "toolcall_end", contentIndex: i, toolCall, partial: message };
      }
      yield { type: "done", reason: message.stopReason as typeof event.reason, message };
    } else if (event.type === "error") {
      yield { ...event, error: clean(event.error) };
    } else {
      const partial = clean(event.partial);
      if (event.type === "text_delta" || event.type === "text_end") {
        const block = partial.content[event.contentIndex];
        const text = block?.type === "text" ? block.text : "";
        const delta = text.slice((emitted.get(event.contentIndex) ?? "").length);
        emitted.set(event.contentIndex, text);
        if (event.type === "text_end") yield { ...event, content: text, partial };
        else if (delta) yield { ...event, delta, partial };
      } else yield { ...event, partial };
    }
  }
}
