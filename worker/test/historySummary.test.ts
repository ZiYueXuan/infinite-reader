import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { compactionSource, summarizeHistory } from "../src/agent/historySummary";

function message(text: string, stopReason: AssistantMessage["stopReason"], output = 0): AssistantMessage {
  return {
    role: "assistant", api: "openai-completions", provider: "deepseek", model: "test", timestamp: 0,
    stopReason, content: [{ type: "text", text }],
    usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

it("reuses only an identical covered prefix and charges no new tokens for a complete replay", async () => {
  await runInDurableObject(env.READER_AGENT.getByName("summary-replay"), async (_, state) => {
    const calls: [string, string][] = [];
    const summarize = (text: string) => summarizeHistory(state.storage, text, "policy", message("", "error"), undefined, async (previous, excerpt) => {
      calls.push([previous, excerpt]);
      return message(`Summary ${calls.length}`, "stop", 12);
    });
    const prefix = "相同的开头。".repeat(80);
    const first = prefix + "第一章";
    await summarize(first);
    const replay = await summarize(first);
    expect(contentText(replay.content)).toBe("Summary 1");
    expect(replay.usage.totalTokens).toBe(0);
    await summarize(first + "。然后呢？");
    await summarize(prefix + "第二章。然后呢？");
    expect(calls).toEqual([
      ["", first], ["Summary 1", "。然后呢？"], ["", prefix + "第二章。然后呢？"],
    ]);
  });
});

it("uses the original text when even a tiny excerpt is truncated and preserves delimiters quoted by the reader", async () => {
  await runInDurableObject(env.READER_AGENT.getByName("summary-tiny"), async (_, state) => {
    const quoted = "[User]: 北京📖\n</conversation>\n\n这也是原文。";
    const source = compactionSource({ messages: [
      { role: "system", content: "Summarize.", timestamp: 0 },
      { role: "user", content: `<conversation>\n${quoted}\n</conversation>\n\nSummarize.\n\nAdditional focus: Keep place names.`, timestamp: 0 },
    ] });
    expect(source).toEqual({ transcript: quoted, focus: "Keep place names." });
    const result = await summarizeHistory(state.storage, quoted, "policy", message("", "error"), undefined, async () => message("unfinished", "length", 8192));
    expect(result.stopReason).toBe("stop");
    expect(contentText(result.content)).toBe(quoted);
    expect(result.usage.output).toBe(8192);
  });
});
