import { beforeEach, describe, expect, it } from "vitest";
import { Client, buildEpub, makeEnv, resetDb } from "./helpers";

beforeEach(resetDb);

async function setup() {
  const te = makeEnv();
  const c = new Client(te);
  await c.login();
  const form = new FormData();
  form.set("file", new File([buildEpub()], "b.epub"));
  const { book } = (await (await c.fetch("/api/books", { method: "POST", body: form })).json()) as any;
  return { te, c, bookId: book.id as string };
}

describe("annotations", () => {
  it("round-trips independent note fonts while keeping the source mark unchanged", async () => {
    const { c, bookId } = await setup();
    const { annotation } = await (await c.fetch(`/api/books/${bookId}/annotations`, { method: 'POST', json: { kind: 'highlight', color: '#ffe066', anchor: { chapter: 0, start: 0, end: 3 } } })).json() as any;
    const anchor = { chapter: 0, start: 0, end: 3, font: 'ma-shan-zheng', textColor: 'blue', tags: ['想法'] };
    const created = await c.fetch(`/api/books/${bookId}/notes`, { method: 'POST', json: { text: '笔记', annotationId: annotation.id, anchor } });
    expect(created.status).toBe(201);
    const { note } = await created.json() as any;
    expect(note.anchor).toEqual(anchor);
    for (const font of ['long-cang', 'zhi-mang-xing', 'caveat', 'noto-serif', 'noto-sans', 'wenkai']) {
      const response = await c.fetch(`/api/books/${bookId}/notes/${note.id}`, { method: 'PATCH', json: { anchor: { ...anchor, font } } });
      expect(response.status).toBe(200);
      const { notes } = await (await c.fetch(`/api/books/${bookId}/notes`)).json() as any;
      expect(notes[0].anchor).toEqual({ ...anchor, font });
    }
    const { font: _font, ...inherited } = anchor;
    await c.fetch(`/api/books/${bookId}/notes/${note.id}`, { method: 'PATCH', json: { anchor: inherited } });
    const { notes } = await (await c.fetch(`/api/books/${bookId}/notes`)).json() as any;
    expect(notes[0].anchor.font).toBeUndefined();
    const { annotations } = await (await c.fetch(`/api/books/${bookId}/annotations`)).json() as any;
    expect(annotations[0].color).toBe('#ffe066');
  });

  it("creates, lists, updates and deletes", async () => {
    const { c, bookId } = await setup();
    const anchor = { href: "OEBPS/text/ch1.xhtml", start: 10, end: 42, quote: "whales sentence", prefix: "a", suffix: "b" };
    const created = await c.fetch(`/api/books/${bookId}/annotations`, {
      method: "POST",
      json: { kind: "highlight", color: "#ffe066", anchor, text: "whales sentence" },
    });
    expect(created.status).toBe(201);
    const ann = ((await created.json()) as any).annotation;
    expect(ann.anchor).toEqual(anchor);
    expect(ann.color).toBe("#ffe066");

    const patched = await c.fetch(`/api/books/${bookId}/annotations/${ann.id}`, { method: "PATCH", json: { kind: "underline", color: "#00ff00" } });
    expect(((await patched.json()) as any).annotation.kind).toBe("underline");

    const list = ((await (await c.fetch(`/api/books/${bookId}/annotations`)).json()) as any).annotations;
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("underline");

    const future = ((await (await c.fetch(`/api/books/${bookId}/annotations?since=${Date.now() + 100000}`)).json()) as any).annotations;
    expect(future).toHaveLength(0);

    expect((await c.fetch(`/api/books/${bookId}/annotations/${ann.id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await (await c.fetch(`/api/books/${bookId}/annotations`)).json()) as any).annotations).toHaveLength(0);
  });

  it("accepts client ids, rejects duplicates and invalid payloads", async () => {
    const { c, bookId } = await setup();
    const body = { id: "client-gen-id-1", kind: "highlight", anchor: { start: 1, end: 2 } };
    expect((await c.fetch(`/api/books/${bookId}/annotations`, { method: "POST", json: body })).status).toBe(201);
    expect((await c.fetch(`/api/books/${bookId}/annotations`, { method: "POST", json: body })).status).toBe(409);
    expect((await c.fetch(`/api/books/${bookId}/annotations`, { method: "POST", json: { kind: "strike", anchor: { a: 1 } } })).status).toBe(400);
    expect((await c.fetch(`/api/books/${bookId}/annotations`, { method: "POST", json: { kind: "highlight", anchor: {} } })).status).toBe(400);
    expect((await c.fetch(`/api/books/${bookId}/annotations`, { method: "POST", json: { kind: "highlight", color: "red;x", anchor: { a: 1 } } })).status).toBe(400);
  });

    it("accepts reader clause marks", async () => {
        const {c, bookId} = await setup();
        const created = await c.fetch(`/api/books/${bookId}/annotations`, {
            method: "POST",
            json: {kind: "judou", anchor: {chapter: 0, start: 4, end: 5}, text: "也"}
        });
        expect(created.status).toBe(201);
        expect(((await created.json()) as any).annotation.kind).toBe("judou");
    });

  it("is private to the owner", async () => {
    const { te, c, bookId } = await setup();
    const created = await c.fetch(`/api/books/${bookId}/annotations`, { method: "POST", json: { kind: "highlight", anchor: { a: 1 } } });
    const ann = ((await created.json()) as any).annotation;
    const other = new Client(te);
    await other.login("other@example.com");
    expect((await other.fetch(`/api/books/${bookId}/annotations`)).status).toBe(404);
    expect((await other.fetch(`/api/books/${bookId}/annotations/${ann.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("notes", () => {
  it("persists note text ink independently of its linked source mark", async () => {
    const { c, bookId } = await setup();
    const created = await c.fetch(`/api/books/${bookId}/annotations`, { method: "POST", json: { kind: "underline", color: "yellow", anchor: { chapter: 0, start: 0, end: 3 } } });
    const ann = ((await created.json()) as any).annotation;
    const noteResponse = await c.fetch(`/api/books/${bookId}/notes`, { method: "POST", json: { text: "independent ink", annotationId: ann.id, color: "#315f91", anchor: { chapter: 0, start: 0, end: 3, textColor: "blue" } } });
    expect(noteResponse.status).toBe(201);
    const note = ((await noteResponse.json()) as any).note;
    await c.fetch(`/api/books/${bookId}/notes/${note.id}`, { method: "PATCH", json: { color: "#69469a", anchor: { ...note.anchor, textColor: "violet" } } });
    let marks = ((await (await c.fetch(`/api/books/${bookId}/annotations`)).json()) as any).annotations;
    expect(marks[0].color).toBe("yellow");
    await c.fetch(`/api/books/${bookId}/annotations/${ann.id}`, { method: "PATCH", json: { color: "pink" } });
    const notes = ((await (await c.fetch(`/api/books/${bookId}/notes`)).json()) as any).notes;
    expect(notes[0]).toMatchObject({ color: "#69469a", anchor: { textColor: "violet" } });
    marks = ((await (await c.fetch(`/api/books/${bookId}/annotations`)).json()) as any).annotations;
    expect(marks[0].color).toBe("pink");
    await c.fetch(`/api/books/${bookId}/notes/${note.id}`, { method: "PATCH", json: { color: "#62584b", anchor: { chapter: 0, start: 0, end: 3 } } });
    const reset = ((await (await c.fetch(`/api/books/${bookId}/notes`)).json()) as any).notes;
    expect(reset[0].anchor.textColor).toBeUndefined();
  });

  it("supports sticky-note CRUD with canvas position", async () => {
    const { c, bookId } = await setup();
    const created = await c.fetch(`/api/books/${bookId}/notes`, {
      method: "POST",
      json: { text: "remember this", x: 120.5, y: -40, width: 240, height: 160, z: 3, color: "#fff3a3" },
    });
    expect(created.status).toBe(201);
    const note = ((await created.json()) as any).note;
    expect(note).toMatchObject({ text: "remember this", x: 120.5, y: -40, width: 240, height: 160, z: 3 });

    const moved = await c.fetch(`/api/books/${bookId}/notes/${note.id}`, { method: "PATCH", json: { x: 300, y: 10, text: "edited", annotationId: null } });
    expect(((await moved.json()) as any).note).toMatchObject({ x: 300, y: 10, text: "edited", width: 240 });

    const list = ((await (await c.fetch(`/api/books/${bookId}/notes`)).json()) as any).notes;
    expect(list).toHaveLength(1);
    expect((await c.fetch(`/api/books/${bookId}/notes/${note.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await c.fetch(`/api/books/${bookId}/notes/${note.id}`, { method: "PATCH", json: { x: 1 } })).status).toBe(404);
  });

  it("validates positions", async () => {
    const { c, bookId } = await setup();
    expect((await c.fetch(`/api/books/${bookId}/notes`, { method: "POST", json: { x: "a" } })).status).toBe(400);
  });

  it("stores sticky-note tags in the note anchor", async () => {
    const { c, bookId } = await setup();
    const anchor = { chapter: 1, start: 0, end: 4, rot: 0.1, tags: ["myth", "悲剧"] };
    const created = await c.fetch(`/api/books/${bookId}/notes`, {
      method: "POST",
      json: { text: "remember", x: 1, y: 2, color: "pink", anchor },
    });
    expect(created.status).toBe(201);
    const note = ((await created.json()) as any).note;
    expect(note.anchor.tags).toEqual(["myth", "悲剧"]);

    const patched = await c.fetch(`/api/books/${bookId}/notes/${note.id}`, {
      method: "PATCH",
      json: { anchor: { ...anchor, tags: ["edited"] } },
    });
    expect(((await patched.json()) as any).note.anchor.tags).toEqual(["edited"]);

    const list = ((await (await c.fetch(`/api/books/${bookId}/notes`)).json()) as any).notes;
    expect(list[0].anchor.tags).toEqual(["edited"]);
    expect(list[0].text).toBe("remember");
  });
});
