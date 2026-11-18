import { TERMS_VERSION } from '../../shared/terms';
export const termsConsent = { accepted: true, version: TERMS_VERSION } as const;
export const costDebugEmail = "cost-admin@example.test";
import { createExecutionContext, waitOnExecutionContext, runInDurableObject } from "cloudflare:test";
import { env as baseEnv } from "cloudflare:workers";
import { strToU8, zipSync } from "fflate";
import { vi } from "vitest";
import { app } from "../src/index";
import { readerAgent } from "../src/agent/protocol";

export const DIM = 64;

function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
    v[h % DIM]! += 1;
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}

export class FakeVectorize {
  store = new Map<string, { id: string; namespace: string; values: number[] }>();
  async upsert(vectors: { id: string; namespace?: string; values: number[] }[]) {
    if (vectors.length > 1000) throw new Error("too many vectors");
    for (const v of vectors) this.store.set(v.id, { id: v.id, namespace: v.namespace ?? "", values: v.values });
    return { mutationId: "m" };
  }
  async deleteByIds(ids: string[]) {
    if (ids.length > 100) throw new Error("VECTOR_DELETE_ERROR (code = 40007): too many ids in payload; max id count is 100");
    for (const id of ids) this.store.delete(id);
    return { mutationId: "m" };
  }
  async query(vec: number[], opts: { topK: number; namespace?: string }) {
    const matches = [...this.store.values()]
      .filter((v) => v.namespace === (opts.namespace ?? ""))
      .map((v) => ({ id: v.id, score: v.values.reduce((a, x, i) => a + x * vec[i]!, 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK);
    return { matches, count: matches.length };
  }
}

export const fakeAI = {
  async run(_model: string, input: { text: string[] }) {
    return { data: input.text.map(embed) };
  },
};

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

export function makeEnv(extra: Record<string, unknown> = {}) {
  const sent: SentMail[] = [];
  const vectorize = new FakeVectorize();
  const env = {
    ...baseEnv,
    SESSION_SECRET: "test-secret-test-secret-test-secret",
    GOOGLE_CLIENT_ID: "gid",
    GOOGLE_CLIENT_SECRET: "gsecret",
    DEEPSEEK_API_KEY: "sk-test",
    DEEPSEEK_BASE_URL: "https://llm.test",
    COST_DEBUG_EMAILS: costDebugEmail,
    EMAIL_PROVIDER: "cloudflare",
    AI: fakeAI,
    VECTORIZE: vectorize,
    EMAIL: {
      async send(m: SentMail) {
        sent.push(m);
        return { messageId: "msg" };
      },
    },
    ...extra,
  } as unknown as Env;
  return { env, sent, vectorize };
}

export type TestEnv = ReturnType<typeof makeEnv>;

export class Client {
  cookie = "";
  constructor(public te: TestEnv) {}

  async fetch(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers.set("content-type", "application/json");
    }
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request(`https://reader.test${path}`, { ...init, headers, body }), this.te.env, ctx);
    const set = res.headers.getSetCookie?.() ?? [];
    for (const sc of set) {
      const [pair] = sc.split(";");
      const [name, value] = pair!.split("=");
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(sc) || value === "") {
        this.cookie = this.cookie
          .split("; ")
          .filter((p) => !p.startsWith(`${name}=`))
          .join("; ");
      } else if (name!.includes("session")) {
        this.cookie = `${name}=${value}`;
      }
    }
    // Read the body now so streaming handlers finish, then drain waitUntil work (indexing, persistence).
    const buf = await res.arrayBuffer();
    await waitOnExecutionContext(ctx);
    return new Response(buf, { status: res.status, headers: res.headers });
  }

  async login(email = "reader@example.com") {
    const r = await this.fetch("/api/auth/email/request", { method: "POST", json: { email } });
    if (r.status !== 200) throw new Error(`request failed ${r.status} ${await r.text()}`);
    const code = this.te.sent.at(-1)!.text.match(/\b(\d{6})\b/)![1]!;
    const v = await this.fetch("/api/auth/email/verify", { method: "POST", json: { email, code, terms: termsConsent } });
    if (v.status !== 200) throw new Error(`verify failed ${v.status}`);
    return (await v.json()) as { user: { id: string; email: string } };
  }
}

export async function resetDb() {
  const tables = ["cost_events", "terms_acceptances", "ai_usage", "chat_messages", "notes", "annotations", "chunks", "books", "login_codes", "sessions", "rate_limits", "users"];
  for (const t of tables) await baseEnv.DB.prepare(`DELETE FROM ${t}`).run();
  const list = await baseEnv.BOOKS.list();
  for (const o of list.objects) await baseEnv.BOOKS.delete(o.key);
}

export async function setupReaderAgent(extra: Record<string, unknown> = {}) {
  const te = makeEnv(extra);
  const client = new Client(te);
  const { user } = await client.login();
  const form = new FormData();
  form.set("file", new File([buildEpub()], "book.epub"));
  const { book } = await (await client.fetch("/api/books", { method: "POST", body: form })).json() as { book: { id: string } };
  const scope = { userId: user.id, bookId: book.id, threadId: "default" };
  const stub = readerAgent(te.env, scope);
  const inject = () => runInDurableObject(readerAgent(te.env, scope), instance => { Object.assign((instance as unknown as { env: Env }).env, te.env); });
  await inject();
  return { te, client, scope, stub, bookId: book.id, inject };
}

export function toolStream(name: string, args: unknown, id = "tool-1"): Response {
  const argument = JSON.stringify(args);
  const events = [
    { choices: [{ delta: { role: "assistant", reasoning_content: "Consult the book." } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: argument.slice(0, 5) } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argument.slice(5) } }] }, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ];
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

const para = (n: number, topic: string) =>
  Array.from({ length: n }, (_, i) => `<p>${topic} sentence number ${i}. The ${topic} keeps going with more detail about ${topic}.</p>`).join("\n");

export function buildEpub(opts: { title?: string } = {}): Uint8Array {
  const title = opts.title ?? "Test Book";
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${title}</dc:title><dc:creator>Ada Author</dc:creator><dc:language>en</dc:language>
  <meta name="cover" content="cover-img"/>
 </metadata>
 <manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  <item id="cover-img" href="images/cover.png" media-type="image/png"/>
 </manifest>
 <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol><li><a href="text/ch1.xhtml">Chapter One</a></li><li><a href="text/ch2.xhtml#s1">Chapter Two</a></li></ol></nav></body></html>`),
    "OEBPS/text/ch1.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><h1>Chapter One</h1>${para(12, "whales")}</body></html>`,
    ),
    "OEBPS/text/ch2.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter Two</h1>${para(12, "volcanoes")}<p>caf&eacute; &amp; &#8212; done</p></body></html>`,
    ),
    "OEBPS/images/cover.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
  };
  return zipSync(files, { level: 0 });
}

/** Route outbound fetches to fakes (DeepSeek / Google); everything else is rejected. */
export function mockFetch(handlers: Record<string, (req: Request) => Response | Promise<Response>>) {
  const calls: Request[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    calls.push(req);
    for (const [prefix, h] of Object.entries(handlers)) if (req.url.startsWith(prefix)) return h(req);
    throw new Error(`unexpected fetch ${req.url}`);
  });
  return { calls, restore: () => spy.mockRestore() };
}

export function sseStream(chunks: string[], usage = { prompt_tokens: 10, completion_tokens: 5 }, finishReason: "stop" | "length" = "stop"): Response {
  const enc = new TextEncoder();
  const lines = [
    ...chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

export function parseSse(text: string): { event: string; data: any }[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((blk) => {
      const ev = blk.match(/^event: (.*)$/m)?.[1] ?? "message";
      const data = blk.match(/^data: (.*)$/m)?.[1];
      return { event: ev, data: data ? JSON.parse(data) : null };
    });
}
