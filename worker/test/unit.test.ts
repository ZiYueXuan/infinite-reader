import { describe, expect, it } from "vitest";
import { chunkText } from "../src/pipeline/chunk";
import { htmlToText, parseEpub, resolvePath } from "../src/pipeline/epub";
import { randomCode, safeEqual } from "../src/lib/util";
import { buildEpub } from "./helpers";

describe("chunkText", () => {
  it("keeps offsets consistent with the source text and bounds chunk size", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(40)).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1200);
      expect(text.slice(c.start, c.end).trim()).toBe(c.text);
    }
    expect(chunks.at(-1)!.end).toBe(text.length);
  });

  it("splits oversized CJK paragraphs without whitespace", () => {
    const text = "这是一个很长的句子。".repeat(400);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.length <= 1200)).toBe(true);
  });

  it("returns nothing for empty text and terminates on tiny input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("hi")).toHaveLength(1);
  });
});

describe("epub", () => {
  it("parses metadata, toc, chapters and cover", () => {
    const p = parseEpub(buildEpub({ title: "Whales & Volcanoes" }));
    expect(p.title).toBe("Whales & Volcanoes");
    expect(p.author).toBe("Ada Author");
    expect(p.language).toBe("en");
    expect(p.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(p.chapters[0]!.href).toBe("OEBPS/text/ch1.xhtml");
    expect(p.toc.map((t) => t.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(p.chapters[1]!.text).toContain("café & — done");
    expect(p.cover?.mime).toBe("image/png");
  });

  it("rejects non-epub zips", () => {
    expect(() => parseEpub(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("html helpers", () => {
    expect(htmlToText("<body><p>a&nbsp;b</p><script>x()</script><p>c<br/>d</p></body>")).toBe("a b\n\nc\nd");
    expect(resolvePath("OEBPS/text/", "../images/a%20b.png")).toBe("OEBPS/images/a b.png");
  });
});

describe("util", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 50; i++) expect(randomCode()).toMatch(/^\d{6}$/);
  });
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("static legal pages", () => {
  it("serves /about, /privacy and /terms as HTML", async () => {
    const { makeEnv, Client } = await import("./helpers");
    const c = new Client(makeEnv());
    for (const [path, needle] of [
      ["/about", "infinite canvas"],
      ["/privacy", "Privacy Policy"],
      ["/terms/", "Terms of Use"],
    ] as const) {
      const r = await c.fetch(path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
      expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
      const html = await r.text();
      expect(html).toContain(needle);
      expect(html).toContain('href="/privacy?lang=en"');
    }
    expect(await (await c.fetch("/privacy")).text()).toContain("owner@example.com");
  });
});
