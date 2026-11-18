import { describe, expect, it } from "vitest";
import { Type, type AssistantMessage, type AssistantMessageEvent, type Tool } from "@earendil-works/pi-ai";
import { normalizeToolProtocol } from "../src/agent/toolProtocol";
import { visibleAnswer } from "../../shared/agentText";

const tools = [{ name: "read_book_passage", description: "Read", parameters: Type.Object({ chapter: Type.Integer({ minimum: 0 }), start: Type.Optional(Type.Integer({ minimum: 0 })) }) }];
const dsml = '<｜DSML｜calls><｜DSML｜invoke name="read_book_passage"><｜DSML｜parameter name="chapter" string="false">5</｜DSML｜parameter><｜DSML｜parameter name="start" string="false">9420</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>';
const message = (text: string): AssistantMessage => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "deepseek", model: "test", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 1 });
async function run(text: string, allowed = true, stopReason: AssistantMessage["stopReason"] = "stop", activeTools: Tool[] = tools) {
  async function* events(): AsyncGenerator<AssistantMessageEvent> {
    yield { type: "start", partial: message("") };
    yield { type: "text_start", contentIndex: 0, partial: message("") };
    for (let i = 1; i <= text.length; i++) yield { type: "text_delta", contentIndex: 0, delta: text[i - 1], partial: message(text.slice(0, i)) };
    yield { type: "text_end", contentIndex: 0, content: text, partial: message(text) };
    yield { type: "done", reason: stopReason as "stop", message: { ...message(text), stopReason } };
  }
  const out: AssistantMessageEvent[] = [];
  for await (const event of normalizeToolProtocol(events(), activeTools, allowed)) out.push(event);
  return out;
}

describe("DeepSeek tool protocol compatibility", () => {
  it.each([dsml, dsml.replaceAll("｜", "|")])("recovers complete calls without exposing any split protocol prefix", async raw => {
    const events = await run("I will read the passage.\n" + raw);
    const text = events.filter(e => e.type === "text_delta").map(e => e.delta).join("");
    expect(text.trim()).toBe("I will read the passage.");
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type !== "done") throw Error("Expected done");
    expect(done.reason).toBe("toolUse");
    expect(done.message.content.at(-1)).toMatchObject({ type: "toolCall", name: "read_book_passage", arguments: { chapter: 5, start: 9420 } });
    expect(JSON.stringify(done.message)).not.toContain("DSML");
    expect(done.message.usage.totalTokens).toBe(3);
  });
  it.each([
    "unfinished <｜DSM", dsml.slice(0, -5), dsml.replace('>5<', '>NaN<'), dsml.replace('>5<', '>-1<'),
    dsml.replace('name="read_book_passage"', 'name="delete_book"'), dsml + " trailing text",
    "```xml\n" + dsml + "\n```", dsml.replace('name="chapter"', 'name="__proto__"'),
  ])("fails closed on malformed, unknown or quoted calls", async raw => {
    const events = await run(raw);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { errorMessage: "llm_tool_protocol" } });
    expect(events.some(e => e.type === "toolcall_end")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("DSML");
  });
  it("keeps string arguments literal and supports multiple validated calls", async () => {
    const raw = '<｜DSML｜calls><｜DSML｜invoke name="search_book"><｜DSML｜parameter name="query" string="true">  &amp; <｜DSML｜literal>  </｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>';
    const search = [{ name: "search_book", description: "Search", parameters: Type.Object({ query: Type.String() }) }];
    const events = await run(raw, true, "stop", search);
    expect(events.at(-1)).toMatchObject({ type: "done", message: { content: [{ type: "text", text: "" }, { type: "toolCall", arguments: { query: "  &amp; <｜DSML｜literal>  " } }] } });
    const repeated = dsml.replace('</｜DSML｜calls>', '') + dsml.replace('<｜DSML｜calls>', '');
    const multi = await run(repeated);
    expect(multi.filter(e => e.type === "toolcall_end")).toHaveLength(2);
  });
  it("does not execute calls when disabled or truncated by the token limit", async () => {
    expect((await run(dsml, false)).at(-1)?.type).toBe("error");
    expect((await run(dsml, true, "length")).at(-1)?.type).toBe("error");
  });
  it("preserves ordinary prose and Markdown, including angle brackets", async () => {
    const text = "Use **x < 5** and <em>text</em>.";
    const events = await run(text);
    expect(events.filter(e => e.type === "text_delta").map(e => e.delta).join("")).toBe(text);
    expect(events.at(-1)).toMatchObject({ type: "done", message: { content: [{ type: "text", text }] } });
    expect(visibleAnswer("saved answer\n" + dsml, true)).toBe("saved answer");
  });
});
