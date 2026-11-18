import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteBookIndex, handleIndexMessage } from "../src/pipeline";
import { Client, buildEpub, makeEnv, resetDb, fakeAI } from "./helpers";

beforeEach(resetDb);

async function upload(c: Client, bytes: Uint8Array = buildEpub(), name = "whales.epub") {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type: "application/epub+zip" }));
  return c.fetch("/api/books", { method: "POST", body: form });
}

describe("books pipeline", () => {
  it("uploads, parses, chunks, embeds and reports status", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const res = await upload(c);
    expect(res.status).toBe(202);
    const { book } = (await res.json()) as any;
    expect(book.status).toBe("uploaded");

    const status = (await (await c.fetch(`/api/books/${book.id}/status`)).json()) as any;
    expect(status.status).toBe("ready");
    expect(status.percent).toBe(100);
    expect(status.chunkCount).toBeGreaterThan(2);
    expect(status.indexedChunks).toBe(status.chunkCount);
    expect(te.vectorize.store.size).toBe(status.chunkCount);

    const detail = ((await (await c.fetch(`/api/books/${book.id}`)).json()) as any).book;
    expect(detail.title).toBe("Test Book");
    expect(detail.author).toBe("Ada Author");
    expect(detail.hasCover).toBe(true);
    expect(detail.toc.map((t: any) => t.title)).toEqual(["Chapter One", "Chapter Two"]);

    const list = ((await (await c.fetch("/api/books")).json()) as any).books;
    expect(list).toHaveLength(1);

    const cover = await c.fetch(`/api/books/${book.id}/cover`);
    expect(cover.headers.get("content-type")).toBe("image/png");
  });

  it("serves the original file with range support", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const bytes = buildEpub();
    const { book } = (await (await upload(c, bytes)).json()) as any;
    const full = await c.fetch(`/api/books/${book.id}/file`);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("application/epub+zip");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    const part = await c.fetch(`/api/books/${book.id}/file`, { headers: { range: "bytes=0-9" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-9/${bytes.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(0, 10));
  });

  it("accepts a raw body upload", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const r = await c.fetch("/api/books", {
      method: "POST",
      body: buildEpub(),
      headers: { "content-type": "application/epub+zip", "x-filename": encodeURIComponent("我的书.epub") },
    });
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).book.filename).toBe("我的书.epub");
  });

  it("rejects non-epub, empty and oversized uploads and requires auth", async () => {
    const te = makeEnv();
    const anon = new Client(te);
    expect((await upload(anon)).status).toBe(401);
    const c = new Client(te);
    await c.login();
    expect((await upload(c, new TextEncoder().encode("hello world, not a zip"))).status).toBe(415);
    expect((await upload(c, new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set([0x50, 0x4b, 3, 4]);
    expect((await upload(c, big)).status).toBe(413);
  });

  it("marks a corrupt epub as failed", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const bad = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const { book } = (await (await upload(c, bad)).json()) as any;
    const status = (await (await c.fetch(`/api/books/${book.id}/status`)).json()) as any;
    expect(status.status).toBe("failed");
    expect(status.error).toBeTruthy();
  });

  it("isolates users and deletes everything", async () => {
    const te = makeEnv();
    const a = new Client(te);
    await a.login("a@example.com");
    const { book } = (await (await upload(a)).json()) as any;
    const b = new Client(te);
    await b.login("b@example.com");
    expect((await b.fetch(`/api/books/${book.id}`)).status).toBe(404);
    expect((await b.fetch(`/api/books/${book.id}/file`)).status).toBe(404);
    expect((await b.fetch(`/api/books/${book.id}`, { method: "DELETE" })).status).toBe(404);
    expect(((await (await b.fetch("/api/books")).json()) as any).books).toHaveLength(0);

    expect(te.vectorize.store.size).toBeGreaterThan(0);
    expect((await a.fetch(`/api/books/${book.id}`, { method: "DELETE" })).status).toBe(200);
    expect(te.vectorize.store.size).toBe(0);
    expect((await env.BOOKS.list()).objects).toHaveLength(0);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM chunks").first<{ n: number }>())!.n).toBe(0);
  });

  it("stores progress and canvas state; patch edits metadata", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const { book } = (await (await upload(c)).json()) as any;
    expect((await c.fetch(`/api/books/${book.id}/progress`, { method: "PUT", json: { percent: 42.5, chapterIndex: 1, location: { cfi: "epubcfi(/6/4)" } } })).status).toBe(200);
    expect((await c.fetch(`/api/books/${book.id}/state`, { method: "PUT", json: { viewport: { x: 1, y: 2, zoom: 0.5 } } })).status).toBe(200);
    expect((await c.fetch(`/api/books/${book.id}`, { method: "PATCH", json: { title: "Renamed" } })).status).toBe(200);
    const d = ((await (await c.fetch(`/api/books/${book.id}`)).json()) as any).book;
    expect(d.title).toBe("Renamed");
    expect(d.progress.percent).toBe(42.5);
    expect(d.state.viewport.zoom).toBe(0.5);
  });

  it("reindexes", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const { book } = (await (await upload(c)).json()) as any;
    const n = te.vectorize.store.size;
    expect((await c.fetch(`/api/books/${book.id}/reindex`, { method: "POST" })).status).toBe(202);
    expect(te.vectorize.store.size).toBe(n);
    expect((((await (await c.fetch(`/api/books/${book.id}/status`)).json()) as any).status)).toBe("ready");
  });

  it("deletes the vectors of large books in batches of at most 100 ids", async () => {
    const te = makeEnv();
    const c = new Client(te);
    const { user } = await c.login();
    await env.DB.prepare(
      "INSERT INTO books (id, user_id, title, size_bytes, file_key, created_at, updated_at) VALUES ('big', ?1, 't', 1, 'k', 1, 1)",
    )
      .bind(user.id)
      .run();
    for (let i = 0; i < 250; i++) {
      await env.DB.prepare(
        "INSERT INTO chunks (id, book_id, ordinal, chapter_index, char_start, char_end, text) VALUES (?1, 'big', ?2, 0, 0, 1, 'x')",
      )
        .bind(`big:${i}`, i)
        .run();
      await te.vectorize.upsert([{ id: `big:${i}`, namespace: "big", values: [1] }]);
    }
    await deleteBookIndex(te.env, "big");
    expect(te.vectorize.store.size).toBe(0);
  });
});


describe("book deletion recovery", () => {
  it("cleans vectors written by an embedding job that finishes after deletion", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const { book } = await (await upload(c)).json() as any;
    await env.DB.prepare("UPDATE chunks SET embedded = 0 WHERE book_id = ?").bind(book.id).run();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const entered = new Promise<void>(r => { started = r; });
    te.env.AI = { run: async (model: string, input: { text: string[] }) => {
      started(); await gate; return fakeAI.run(model, input);
    } } as unknown as Ai;
    const job = handleIndexMessage(te.env, { type: "embed", bookId: book.id, from: 0, to: 1 });
    await entered;
    try { expect((await c.fetch(`/api/books/${book.id}`, { method: "DELETE" })).status).toBe(200); }
    finally { release(); }
    await job;
    expect(te.vectorize.store.size).toBe(0);
    expect(await env.DB.prepare("SELECT id FROM books WHERE id = ?").bind(book.id).first()).toBeNull();
    const usage = await env.DB.prepare("SELECT book_id FROM ai_usage").all<{ book_id: string | null }>();
    expect(usage.results.length).toBeGreaterThan(0);
    expect(usage.results.every(r => r.book_id === null)).toBe(true);
  });

  it("retains a retryable deletion when external cleanup fails", async () => {
    const te = makeEnv();
    const c = new Client(te);
    await c.login();
    const { book } = await (await upload(c)).json() as any;
    const original = te.vectorize.deleteByIds.bind(te.vectorize);
    te.vectorize.deleteByIds = async () => { throw new Error("temporary vector outage"); };
    expect((await c.fetch(`/api/books/${book.id}`, { method: "DELETE" })).status).toBe(500);
    expect(await env.DB.prepare("SELECT status FROM books WHERE id = ?").bind(book.id).first()).toEqual({ status: "deleting" });
    expect((await c.fetch(`/api/books/${book.id}/reindex`, { method: "POST" })).status).toBe(404);
    te.vectorize.deleteByIds = original;
    expect((await c.fetch(`/api/books/${book.id}`, { method: "DELETE" })).status).toBe(200);
    expect(te.vectorize.store.size).toBe(0);
    expect((await env.BOOKS.list()).objects).toHaveLength(0);
  });
});
