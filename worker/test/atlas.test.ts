import { env } from "cloudflare:workers";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atlasPrefix, reusableAtlasResult } from "../src/atlas/cache";
import { sha256Hex } from "../src/lib/util";
import { ATLAS_VERSION } from "../src/atlas/recognition";
import { extractAtlasImage, MAX_IMAGE_BYTES } from "../src/atlas/image";
import { ATLAS_FALLBACK_MODEL, ATLAS_FALLBACK_TIMEOUT_MS, ATLAS_PRIMARY_TIMEOUT_MS, locateCity, recognizeMap, resolveRecognition, visionSchema } from "../src/atlas/recognition";
import { Client, buildEpub, makeEnv, mockFetch, resetDb } from "./helpers";

beforeEach(resetDb);
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });
const path = "OEBPS/images/cover.png";
const vision = () => ({
  isMap: true, confidence: 0.97, title: "西欧", period: "1940", number: "1", bounds: [[-12, 35], [16, 64]],
  places: [
    { name: "伦敦", modernName: "London", countryCode: "GB", confidence: 0.96, imagePoint: [0.5, 0.4] },
    { name: "巴黎", modernName: "Paris", countryCode: "FR", confidence: 0.98, imagePoint: [0.6, 0.6] },
    { name: "不明小镇", modernName: "Made Up Town", countryCode: "FR", confidence: 0.9, imagePoint: null },
  ],
});
const upstream = (content: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
const completion = (content: unknown) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
function fallback(te: ReturnType<typeof makeEnv>, answer: unknown = completion(vision())) {
  const run = vi.fn(async (_model: string, _input: any, _options?: { signal?: AbortSignal }) => answer);
  te.env.AI = { run } as unknown as Env["AI"];
  return run;
}
async function setup() {
  const te = makeEnv();
  const client = new Client(te);
  const { user } = await client.login();
  const form = new FormData();
  form.set("file", new File([buildEpub()], "atlas.epub"));
  const { book } = await (await client.fetch("/api/books", { method: "POST", body: form })).json() as any;
  const endpoint = `/api/books/${book.id}/atlas`;
  const request = (json: unknown = { path }) => client.fetch(endpoint, { method: "POST", json });
  return { te, client, user, book, endpoint, request };
}

describe("on-demand map recognition", () => {
  it("requires authentication and book ownership before any model call or cache access", async () => {
    const { te, request, endpoint } = await setup();
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream(vision()) }).restore;
    expect((await request()).status).toBe(200);
    expect((await new Client(te).fetch(endpoint, { method: "POST", json: { path } })).status).toBe(401);
    const other = new Client(te);
    await other.login("other@example.com");
    expect((await other.fetch(endpoint, { method: "POST", json: { path } })).status).toBe(404);
    expect((await request({ path, refresh: true, url: "https://evil.test" })).status).toBe(400);
  });

  it("sends the owned original image to vision, matches real coordinates, caches and explicitly refreshes", async () => {
    const { request, te } = await setup();
    const run = fallback(te);
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": async (req) => {
      calls++;
      const body = await req.json() as any;
      expect(req.headers.get("authorization")).toBe("Bearer sk-test");
      expect(body.model).toBe("deepseek-flash");
      expect(body.thinking.type).toBe("disabled");
      expect(body.response_format.type).toBe("json_object");
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
      return upstream(vision());
    } }).restore;
    const first = await (await request()).json() as any;
    expect(first.status).toBe("recognized");
    expect(first.cached).toBe(false);
    expect(first.map.places).toHaveLength(2);
    expect(first.map.places[0].coordinates[0]).toBeCloseTo(-0.118668, 3);
    expect(first.map.recognition.unresolved).toEqual(["不明小镇"]);
    expect(first.map.image.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await (await request()).json() as any).cached).toBe(true);
    expect(calls).toBe(1);
    expect((await (await request({ path, refresh: true })).json() as any).cached).toBe(false);
    expect(calls).toBe(2);
    expect(run).not.toHaveBeenCalled();
    const ledger = await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'atlas_primary'").all<any>();
    expect(ledger.results).toHaveLength(2); // cached reads never create paid-call records.
    expect(ledger.results.every((row) => row.status === "succeeded" && row.usage_status === "unavailable")).toBe(true);
  });

  it("retains old non-maps across repacking and path changes; refresh and changed bytes invoke vision", async () => {
    const { request, user, book } = await setup();
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": () => {
      calls++;
      return upstream({ isMap: false, confidence: 0.99 });
    } }).restore;
    expect(await (await request()).json()).toMatchObject({ status: "not_map", cached: false });
    const key = (await env.BOOKS.list({ prefix: atlasPrefix(user.id, book.id) })).objects[0]!.key;
    const entry = await (await env.BOOKS.get(key))!.json<any>();
    entry.version = "old-model-version";
    entry.result.recognizedAt -= 400 * 86400_000;
    await env.BOOKS.put(key, JSON.stringify(entry));
    expect(await (await request()).json()).toMatchObject({ status: "not_map", cached: true });
    const row = await env.DB.prepare("SELECT file_key FROM books WHERE id = ?1").bind(book.id).first<any>();
    const files = unzipSync(buildEpub());
    const renamed = "OEBPS/images/renamed.png";
    files[renamed] = files[path]!;
    delete files[path];
    files["repack.txt"] = strToU8("new archive, identical image");
    await env.BOOKS.put(row.file_key, zipSync(files));
    expect(await (await request({ path: renamed })).json()).toMatchObject({ cached: true });
    expect(calls).toBe(1);
    expect(await (await request({ path: renamed, refresh: true })).json()).toMatchObject({ cached: false });
    expect(calls).toBe(2);
    files[renamed] = new Uint8Array([...files[renamed]!, 0]);
    await env.BOOKS.put(row.file_key, zipSync(files));
    expect(await (await request({ path: renamed })).json()).toMatchObject({ cached: false });
    expect(calls).toBe(3);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM ai_usage WHERE feature = 'atlas_primary'").first<any>()).n).toBe(3);
  });

  it("migrates expired legacy negatives without inference and does not restore them after refresh", async () => {
    const { request, user, book } = await setup();
    const row = await env.DB.prepare("SELECT file_key FROM books WHERE id = ?1").bind(book.id).first<any>();
    const file = await env.BOOKS.head(row.file_key);
    const key = `${atlasPrefix(user.id, book.id)}${ATLAS_VERSION}/${await sha256Hex(`${file!.etag}:${path}`)}.json`;
    const result = resolveRecognition(visionSchema.parse({ isMap: false, confidence: 0.99 }), { sha256: "a".repeat(64), bytes: 100 });
    result.recognizedAt -= 400 * 86400_000;
    await env.BOOKS.put(key, JSON.stringify(result));
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": () => { calls++; return upstream(vision()); } }).restore;
    expect(await (await request()).json()).toMatchObject({ status: "not_map", cached: true });
    expect(calls).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM ai_usage WHERE feature LIKE 'atlas_%'").first<any>()).n).toBe(0);
    expect(await (await request({ path, refresh: true })).json()).toMatchObject({ status: "recognized", cached: false });
    expect(await (await request()).json()).toMatchObject({ status: "recognized", cached: true });
    expect(calls).toBe(1);
  });

  it("expires uncertain results but retains their short-term cache", async () => {
    const { request, te, user, book } = await setup();
    fallback(te, completion({ ...vision(), confidence: 0.5 }));
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": () => { calls++; return upstream({ ...vision(), confidence: 0.5 }); } }).restore;
    expect(await (await request()).json()).toMatchObject({ status: "uncertain", cached: false });
    expect(await (await request()).json()).toMatchObject({ cached: true });
    const key = (await env.BOOKS.list({ prefix: atlasPrefix(user.id, book.id) })).objects[0]!.key;
    const entry = await (await env.BOOKS.get(key))!.json<any>();
    entry.result.recognizedAt -= 2 * 86400_000;
    await env.BOOKS.put(key, JSON.stringify(entry));
    expect(await (await request()).json()).toMatchObject({ status: "uncertain", cached: false });
    expect(calls).toBe(2);
    const result = resolveRecognition(visionSchema.parse(vision()), { sha256: "a".repeat(64), bytes: 100 });
    expect(reusableAtlasResult(result, true, result.recognizedAt + 29 * 86400_000)).toBe(true);
    expect(reusableAtlasResult(result, true, result.recognizedAt + 31 * 86400_000)).toBe(false);
    expect(reusableAtlasResult(result, false)).toBe(false);
  });

  it("rejects remote URLs, path traversal, absent and unsupported resources", async () => {
    const { request } = await setup();
    for (const bad of ["https://evil.test/a.png", "../private.png", "/a.png", "a/../b.png", "a\\b.png"]) {
      expect((await request({ path: bad })).status).toBe(400);
    }
    expect((await request({ path: "OEBPS/no.png" })).status).toBe(404);
    expect((await request({ path: "OEBPS/content.opf" })).status).toBe(415);
  });

  it("does not cache upstream failures, incomplete JSON or invalid geographic data", async () => {
    const { request } = await setup();
    let response = new Response("private upstream error", { status: 500 });
    let calls = 0;
    restore = mockFetch({ "https://llm.test/chat/completions": () => { calls++; return response; } }).restore;
    expect((await request()).status).toBe(502);
    response = Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
    expect((await request()).status).toBe(502);
    response = upstream({ ...vision(), bounds: [[0, -95], [20, 50]] });
    expect((await request()).status).toBe(502);
    response = upstream(vision());
    expect((await request()).status).toBe(200);
    expect(calls).toBe(4);
  });

  it("keeps valid recognition when the model returns extra places beyond the requested count", async () => {
    const { request } = await setup();
    const value = vision();
    value.places = Array.from({ length: 28 }, (_, i) => vision().places[i % 3]);
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream(value) }).restore;
    const response = await request();
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.status).toBe("recognized");
    expect(result.map.places.map((p: any) => p.name)).toEqual(["伦敦", "巴黎"]);
    expect(result.map.recognition.unresolved).toEqual(["不明小镇"]);
  });

  it("keeps non-maps and uncertain geography separate from successful recognition", async () => {
    const { request, te } = await setup();
    const run = fallback(te, completion({ ...vision(), confidence: 0.5 }));
    let value: unknown = { isMap: false, confidence: 0.99 };
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream(value) }).restore;
    const notMap = await (await request()).json() as any;
    expect(notMap).toMatchObject({ status: "not_map", map: null });
    expect((await (await request()).json() as any).cached).toBe(true);
    expect(run).not.toHaveBeenCalled();
    value = { ...vision(), confidence: 0.5 };
    expect(await (await request({ path, refresh: true })).json()).toMatchObject({ status: "uncertain", map: null });
    value = { ...vision(), places: [vision().places[2]] };
    expect(await (await request({ path, refresh: true })).json()).toMatchObject({ status: "uncertain", map: null });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("limits paid refreshes without preventing access to existing cached results", async () => {
    const { request, user } = await setup();
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream(vision()) }).restore;
    expect((await request()).status).toBe(200);
    const start = Math.floor(Date.now() / 86400_000) * 86400_000;
    await env.DB.prepare("UPDATE rate_limits SET count = 40 WHERE key = ?1 AND window_start = ?2").bind(`atlas:daily:${user.id}`, start).run();
    expect((await request({ path, refresh: true })).status).toBe(429);
    expect((await request()).status).toBe(200);
  });

  it("removes private recognition caches when the book is deleted", async () => {
    const { request, client, user, book } = await setup();
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream(vision()) }).restore;
    await request();
    const prefix = atlasPrefix(user.id, book.id);
    expect((await env.BOOKS.list({ prefix })).objects).toHaveLength(1);
    expect((await client.fetch(`/api/books/${book.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await env.BOOKS.list({ prefix })).objects).toHaveLength(0);
    expect((await request()).status).toBe(404);
    const ledger = await env.DB.prepare("SELECT * FROM ai_usage WHERE feature = 'atlas_primary'").first<any>();
    expect(ledger).toMatchObject({ book_id: null, user_id: user.id, status: "succeeded" });
  });
});

describe("GLM map recognition fallback", () => {
  it("saves primary schema-failure usage and fallback usage separately under one operation", async () => {
    const { request, te, book, user } = await setup();
    fallback(te, { ...completion(vision()), id: "glm-request", usage: {
      prompt_tokens: 2135, completion_tokens: 1501, total_tokens: 3636, prompt_tokens_details: { cached_tokens: 0 }, neurons: 97.34,
    } });
    restore = mockFetch({ "https://llm.test/chat/completions": () => Response.json({
      ...completion({ ...vision(), places: [{ name: "missing required fields" }] }), id: "deepseek-request", model: "deepseek-flash-real",
      usage: { prompt_tokens: 2000, completion_tokens: 500, total_tokens: 2500, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 1900 },
    }) }).restore;
    expect((await request()).status).toBe(200);
    const { results } = await env.DB.prepare("SELECT * FROM ai_usage WHERE feature LIKE 'atlas_%' ORDER BY started_at, rowid").all<any>();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ feature: "atlas_primary", status: "failed", error_code: "atlas_invalid_result", usage_status: "reported", total_tokens: 2500,
      user_id: user.id, book_id: book.id, provider_request_id: "deepseek-request", response_model: "deepseek-flash-real", cached_input_tokens: 100 });
    expect(results[1]).toMatchObject({ feature: "atlas_fallback", provider: "cloudflare", status: "succeeded", total_tokens: 3636, provider_request_id: "glm-request" });
    expect(results[1].operation_id).toBe(results[0].operation_id);
    expect(JSON.parse(results[1].raw_usage).neurons).toBe(97.34);
    expect((await request()).status).toBe(200);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM ai_usage WHERE feature LIKE 'atlas_%'").first<any>()).n).toBe(2);
  });

  it.each(["http", "json", "truncated", "schema", "null lookup fields", "missing lookup fields", "invalid country code"])("recovers from a primary %s failure with exactly one grounded GLM result", async (failure) => {
    const { request, te } = await setup();
    const run = fallback(te);
    restore = mockFetch({ "https://llm.test/chat/completions": () => {
      if (failure === "http") return new Response("private provider details", { status: 503 });
      if (failure === "json") return Response.json({ choices: [{ finish_reason: "stop", message: { content: "{broken" } }] });
      if (failure === "truncated") return Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
      if (failure === "null lookup fields") return upstream({ ...vision(), places: [{ ...vision().places[0], modernName: null, countryCode: null }] });
      if (failure === "missing lookup fields") return upstream({ ...vision(), places: [{ name: "伦敦", confidence: 0.96, imagePoint: null }] });
      if (failure === "invalid country code") return upstream({ ...vision(), places: [{ ...vision().places[0], countryCode: "United Kingdom" }] });
      return upstream({ ...vision(), bounds: [[0, -95], [20, 50]] });
    } }).restore;
    const response = await request();
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result).toMatchObject({ status: "recognized", model: ATLAS_FALLBACK_MODEL, cached: false });
    expect(result.map.recognition).toEqual({ model: ATLAS_FALLBACK_MODEL, unresolved: ["不明小镇"] });
    expect(result.map.places.map((p: any) => p.name)).toEqual(["伦敦", "巴黎"]);
    expect(run).toHaveBeenCalledTimes(1);
    const [model, input, options] = run.mock.calls[0]!;
    expect(model).toBe(ATLAS_FALLBACK_MODEL);
    expect(input).toMatchObject({ response_format: { type: "json_object" }, reasoning_effort: "low", stream: false });
    expect(input.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(await (await request()).json()).toMatchObject({ cached: true, model: ATLAS_FALLBACK_MODEL });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["region", "places"])("retries an uncertain %s without trusting invented coordinates", async (reason) => {
    const { request, te } = await setup();
    const run = fallback(te);
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream(reason === "region"
      ? { ...vision(), confidence: 0.5 } : { ...vision(), places: [vision().places[2]] }) }).restore;
    expect(await (await request()).json()).toMatchObject({ status: "recognized", model: ATLAS_FALLBACK_MODEL });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not cache invalid fallback output, and allows the next request to recover", async () => {
    const { request, te } = await setup();
    const run = fallback(te, completion({ ...vision(), places: [{ ...vision().places[0], countryCode: "United Kingdom" }] }));
    restore = mockFetch({ "https://llm.test/chat/completions": () => new Response("unavailable", { status: 500 }) }).restore;
    expect((await request()).status).toBe(502);
    run.mockResolvedValue(completion(vision()));
    expect(await (await request()).json()).toMatchObject({ status: "recognized", cached: false, model: ATLAS_FALLBACK_MODEL });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps the primary geographic explanation if the fallback provider fails", async () => {
    const { request, te } = await setup();
    const run = fallback(te);
    run.mockRejectedValue(new Error("private upstream details"));
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream({ ...vision(), places: [vision().places[2]] }) }).restore;
    const response = await request();
    expect(response.status).toBe(502);
    const result = await response.json() as any;
    expect(result.error.message).toContain("coordinates");
    run.mockResolvedValue(completion(vision()));
    expect(await (await request()).json()).toMatchObject({ status: "recognized", cached: false, model: ATLAS_FALLBACK_MODEL });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("accepts missing dates and map numbers without discarding valid locations", async () => {
    const { request, te } = await setup();
    const run = fallback(te, completion({ ...vision(), title: null, period: null, number: null }));
    restore = mockFetch({ "https://llm.test/chat/completions": () => upstream({ ...vision(), confidence: 0.5 }) }).restore;
    const result = await (await request()).json() as any;
    expect(result).toMatchObject({ status: "recognized", model: ATLAS_FALLBACK_MODEL, map: { title: "书中地图", period: "", number: "" } });
    expect(result.map.places).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("bounds both provider waits and aborts the actual requests", async () => {
    const te = makeEnv();
    const run = fallback(te);
    let primaryStarted!: () => void, fallbackStarted!: () => void;
    const primaryReady = new Promise<void>((resolve) => { primaryStarted = resolve; });
    const fallbackReady = new Promise<void>((resolve) => { fallbackStarted = resolve; });
    let primarySignal: AbortSignal | undefined;
    restore = mockFetch({ "https://llm.test/chat/completions": (req) => new Promise<Response>((_resolve, reject) => {
      primarySignal = req.signal;
      req.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      primaryStarted();
    }) }).restore;
    run.mockImplementation((_model, _input, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      fallbackStarted();
    }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const work = recognizeMap(te.env, { bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png" }, "Test Book", { operationId: crypto.randomUUID(), userId: null, bookId: null }).catch((error) => error);
    await primaryReady;
    await vi.advanceTimersByTimeAsync(ATLAS_PRIMARY_TIMEOUT_MS);
    await fallbackReady;
    expect(primarySignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(ATLAS_FALLBACK_TIMEOUT_MS);
    expect(await work).toMatchObject({ status: 504, code: "atlas_timeout" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![2]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const { results } = await env.DB.prepare("SELECT status, usage_status, error_code FROM ai_usage").all<any>();
    expect(results).toHaveLength(2);
    expect(results.every((row) => row.status === "aborted" && row.usage_status === "unavailable" && row.error_code === "atlas_timeout")).toBe(true);
  });
});

describe("recognition grounding", () => {
  it("expands an approximate viewport to include unambiguously matched cities near its edge", () => {
    const raw = visionSchema.parse({ ...vision(), bounds: [[-85, 5], [-5, 60]] });
    const result = resolveRecognition(raw, { sha256: "a".repeat(64), bytes: 100 });
    expect(result.map!.places.map((p) => p.name)).toContain("伦敦");
    expect(result.map!.bounds[1][0]).toBeGreaterThan(0);
  });

  it("handles a Pacific map crossing the date line without swapping longitude and latitude", () => {
    const raw = visionSchema.parse({ ...vision(), bounds: [[120, -50], [250, 65]], places: [
      { name: "东京", modernName: "Tokyo", countryCode: "JP", confidence: 0.98, imagePoint: [0.1, 0.2] },
      { name: "檀香山", modernName: "Honolulu", countryCode: "US", confidence: 0.95, imagePoint: [0.8, 0.3] },
    ] });
    const result = resolveRecognition(raw, { sha256: "a".repeat(64), bytes: 100 });
    expect(result.status).toBe("recognized");
    expect(result.map!.places).toHaveLength(2);
    expect(result.map!.center).toEqual([-175, 7.5]);
    expect(result.map!.places[1].coordinates[0]).toBeLessThan(-150);
  });

  it("never fills unknown names with model coordinates, ignores low confidence and wrong-country locations", () => {
    expect(locateCity("Paris", "US", [[-12, 35], [16, 64]])).toBeNull();
    expect(locateCity("Invented", "FR", null)).toBeNull();
    const result = resolveRecognition(visionSchema.parse({ ...vision(), places: [
      { ...vision().places[0], confidence: 0.3, coordinates: [0, 0] },
      vision().places[1],
    ] }), { sha256: "a".repeat(64), bytes: 100 });
    expect(result.map!.places).toHaveLength(1);
    expect(result.map!.places[0].name).toBe("巴黎");
  });

  it("rejects oversized zip members before decompression and non-image payloads", () => {
    const zip = zipSync({ "large.png": new Uint8Array(MAX_IMAGE_BYTES + 1) });
    expect(() => extractAtlasImage(zip, "large.png")).toThrow("6 MB");
    expect(() => extractAtlasImage(zipSync({ "a.jpg": strToU8("not an image") }), "a.jpg")).toThrow("JPEG");
  });
});

describe("saved map listing", () => {
  it("lists successful saved maps without inference, including old caches, and enforces ownership", async () => {
    const { client, te, user, book, endpoint } = await setup();
    const prefix = atlasPrefix(user.id, book.id);
    const result = resolveRecognition(visionSchema.parse(vision()), { sha256: 'a'.repeat(64), bytes: 100 });
    result.recognizedAt -= 400 * 86400_000;
    await env.BOOKS.put(`${prefix}content/old.json`, JSON.stringify({ version: 'old-version', result }));
    await env.BOOKS.put(`${prefix}legacy/map.json`, JSON.stringify(result));
    await env.BOOKS.put(`${prefix}content/negative.json`, JSON.stringify({ version: ATLAS_VERSION, result: { ...result, status: 'not_map', map: null } }));
    await env.BOOKS.put(`${prefix}content/uncertain.json`, JSON.stringify({ version: ATLAS_VERSION, result: { ...result, status: 'uncertain', map: null } }));
    await env.BOOKS.put(`${prefix}content/broken.json`, 'invalid-json');
    const response = await client.fetch(endpoint);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ maps: [{ map: result.map }, { map: result.map }], cursor: null });
    expect((await new Client(te).fetch(endpoint)).status).toBe(401);
    const other = new Client(te);
    await other.login('atlas-other@example.com');
    expect((await other.fetch(endpoint)).status).toBe(404);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM ai_usage WHERE feature LIKE 'atlas_%'").first<any>()).n).toBe(0);
  });

  it("paginates saved maps without losing entries", async () => {
    const { client, user, book, endpoint } = await setup();
    const prefix = atlasPrefix(user.id, book.id);
    const result = resolveRecognition(visionSchema.parse(vision()), { sha256: 'b'.repeat(64), bytes: 100 });
    await Promise.all(Array.from({ length: 101 }, (_, i) => env.BOOKS.put(`${prefix}content/${i}.json`, JSON.stringify({ version: ATLAS_VERSION, result }))));
    const first = await (await client.fetch(endpoint)).json() as any;
    expect(first.maps).toHaveLength(100);
    expect(first.cursor).toBeTruthy();
    const next = await (await client.fetch(`${endpoint}?cursor=${encodeURIComponent(first.cursor)}`)).json() as any;
    expect(next.maps).toHaveLength(1);
    expect(next.cursor).toBeNull();
  });
});
