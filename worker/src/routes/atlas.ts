import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AtlasRecognition } from "../../../shared/atlas";
import { requireAuth, type AppEnv } from "../auth";
import { extractAtlasImage } from "../atlas/image";
import { atlasPrefix, reusableAtlasResult } from "../atlas/cache";
import { ATLAS_VERSION, recognizeMap } from "../atlas/recognition";
import { enforceRateLimit, HttpError, newId, parseBody, sha256Hex } from "../lib/util";
import { ownedBook } from "./books";
import { excludeTextPlaces, TEXT_ATLAS_MAX_CHARS, type TextAtlasResult } from '../../../shared/textAtlas';
import { excludedTextPlaces, textExclusionPrefix } from '../atlas/textExclusions';
import { recognizeTextMap, TEXT_ATLAS_VERSION } from '../atlas/textRecognition';
import gazetteer from '../atlas/data/text-gazetteer.json';
import { reusableTextResult, TEXT_RESOLVER_VERSION } from '../atlas/textGazetteer';
import { enforceTextMapGenerationLimit, enforceTextMapReadLimit } from '../atlas/textLimits';

export const atlas = new Hono<AppEnv>();
atlas.use("*", requireAuth);
atlas.use("*", bodyLimit({ maxSize: 40_000, onError: (c) => c.json({ error: { code: "too_large", message: "Request too large" } }, 413) }));

const schema = z.object({
  path: z.string().min(1).max(512).refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.includes(":") && !p.includes("\0") && !p.split("/").some((s) => !s || s === "." || s === ".."), "Invalid image path"),
  refresh: z.boolean().default(false),
}).strict();
const pending = new Map<string, Promise<AtlasRecognition>>();

const textSchema = z.object({ text: z.string().trim().min(2).max(TEXT_ATLAS_MAX_CHARS), confirmed: z.literal(true), retry: z.boolean().default(false) }).strict();
type TextJob = { status: 'running' | 'failed' | 'ready' | 'rate_limited'; startedAt: number; result?: TextAtlasResult; resolverVersion?: number };
atlas.post('/:id/text-atlas', async c => {
  const book = await ownedBook(c, c.req.param('id'));
  // Consent is required even when clients bypass the confirmation dialog.
  const { text, retry } = await parseBody(c, textSchema);
  const userId = c.get('user').id;
  await enforceTextMapReadLimit(c.env.DB, userId);
  const digest = await sha256Hex(`${TEXT_ATLAS_VERSION}:${gazetteer.sha256}:${text}`);
  const key = `${atlasPrefix(userId, book.id)}text/${digest}.json`;
  const old = await c.env.BOOKS.get(key), previous = old ? await old.json<TextJob>() : null;
  if (previous?.status === 'ready' && previous.result && reusableTextResult(previous.result, previous.resolverVersion)) return c.json(excludeTextPlaces({ ...previous.result, cached: true }, await excludedTextPlaces(c.env.BOOKS, userId, book.id)));
  if (previous?.status === 'running' && Date.now() - previous.startedAt < 120_000) throw new HttpError(409, 'text_atlas_running', '地图正在生成，请稍后重新打开。');
  if (previous && previous.status !== 'ready' && previous.status !== 'rate_limited' && !retry) throw new HttpError(409, 'text_atlas_retry', '上次生成未完成，请再次确认后重试。');
  if (!c.env.DEEPSEEK_API_KEY) throw new HttpError(503, 'llm_not_configured', '地图生成服务尚未配置。');
  if (!await c.env.BOOKS.head(gazetteer.key)) throw new HttpError(503, 'gazetteer_unavailable', '地名库暂不可用，请稍后重试。');
  const startedAt = Date.now();
  // A conditional write is an atomic claim across isolates, not just a UI debounce.
  const claim = await c.env.BOOKS.put(key, JSON.stringify({ status: 'running', startedAt }), {
    onlyIf: old ? { etagMatches: old.etag } : new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/json' },
  });
  if (!claim) throw new HttpError(409, 'text_atlas_running', '地图正在生成，请稍后重新打开。');
  const task = (async () => {
    let admitted = false;
    try {
      await enforceTextMapGenerationLimit(c.env.DB, userId);
      admitted = true;
      const result = await recognizeTextMap(c.env, text, book.title, digest, { operationId: newId(), userId, bookId: book.id });
      result.cacheId = `text-${digest}`;
      // If the book was deleted while running, never recreate its cached content.
      const live = await c.env.DB.prepare("SELECT id FROM books WHERE id = ? AND user_id = ? AND status != 'deleting'").bind(book.id, userId).first();
      if (live) await c.env.BOOKS.put(key, JSON.stringify({ status: 'ready', startedAt, resolverVersion: TEXT_RESOLVER_VERSION, result }), { onlyIf: { etagMatches: claim.etag } });
      return excludeTextPlaces(result, await excludedTextPlaces(c.env.BOOKS, userId, book.id));
    } catch (error) {
      // A denied request must neither replace a usable result nor leave a running lock.
      await c.env.BOOKS.put(key, JSON.stringify(admitted ? { status: 'failed', startedAt } : previous ?? { status: 'rate_limited', startedAt }), { onlyIf: { etagMatches: claim.etag } });
      throw error;
    }
  })();
  // Closing the dialog cannot cause a second paid attempt or lose recorded usage.
  c.executionCtx.waitUntil(task.catch(() => undefined));
  return c.json(await task);
});

atlas.delete('/:id/text-atlas/places/:placeId', async c => {
  const book = await ownedBook(c, c.req.param('id'));
  await parseBody(c, z.object({ confirmed: z.literal(true) }).strict());
  const placeId = z.string().regex(/^geonames:\d{1,12}$/).safeParse(c.req.param('placeId'));
  if (!placeId.success) throw new HttpError(400, 'invalid_place', '无效的地点。');
  const userId = c.get('user').id;
  await enforceRateLimit(c.env.DB, `text-atlas:delete:${userId}`, 30, 60);
  // Preserve original recognition caches; exclusion applies even if inference finishes later.
  await c.env.BOOKS.put(`${textExclusionPrefix(userId, book.id)}${encodeURIComponent(placeId.data)}.json`, JSON.stringify({ deletedAt: Date.now() }));
  return c.json({ deletedPlaceId: placeId.data });
});

// Saved maps remain useful after the inference cache expires. Listing never runs a model
// or downloads/unzips the book; the reader resolves content hashes to its current anchors.
atlas.get("/:id/atlas", async (c) => {
  const book = await ownedBook(c, c.req.param("id"));
  const userId = c.get("user").id;
  await enforceRateLimit(c.env.DB, `atlas:list:${userId}`, 120, 60);
  const excludedPlaceIds = await excludedTextPlaces(c.env.BOOKS, userId, book.id);
  const page = await c.env.BOOKS.list({ prefix: atlasPrefix(userId, book.id), limit: 100, cursor: c.req.query("cursor") });
  const maps: { map: NonNullable<AtlasRecognition['map']>; recognizedAt: number }[] = [];
  const textMaps: TextAtlasResult[] = [];
  for (let i = 0; i < page.objects.length; i += 10) {
    const entries = await Promise.all(page.objects.slice(i, i + 10).map(async ({ key }) => {
      if (key.startsWith(textExclusionPrefix(userId, book.id))) return null;
      const object = await c.env.BOOKS.get(key);
      if (!object) return null;
      try {
        const saved = await object.json<AtlasRecognition | { result: AtlasRecognition | TextAtlasResult }>();
        return 'result' in saved ? saved.result : saved;
      } catch { return null; }
    }));
    for (const result of entries) {
      if (result?.status === 'ready' && result.map?.places.length) textMaps.push(excludeTextPlaces({ ...result, cached: true }, excludedPlaceIds));
      if (result?.status === 'recognized' && result.map?.image) maps.push({ map: result.map, recognizedAt: result.recognizedAt });
    }
  }
  c.header('Cache-Control', 'private, no-store');
  return c.json({ maps, textMaps, excludedPlaceIds, cursor: page.truncated ? page.cursor : null });
});

atlas.post("/:id/atlas", async (c) => {
  const book = await ownedBook(c, c.req.param("id"));
  const { path, refresh } = await parseBody(c, schema);
  const userId = c.get("user").id;
  await enforceRateLimit(c.env.DB, `atlas:read:${userId}`, 60, 60);
  const head = await c.env.BOOKS.head(book.file_key);
  if (!head) throw new HttpError(404, "book_file_missing", "书籍文件不存在。");
  if (head.size > 50 * 1024 * 1024) throw new HttpError(413, "book_too_large", "此书文件过大，暂不支持地图识别。");
  const file = await c.env.BOOKS.get(book.file_key);
  if (!file) throw new HttpError(404, "book_file_missing", "书籍文件不存在。");
  const image = extractAtlasImage(new Uint8Array(await file.arrayBuffer()), path);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(image.bytes));
  const prefix = atlasPrefix(userId, book.id);
  // Content identity survives archive repacking and image-path changes within this book.
  const key = `${prefix}content/${Buffer.from(digest).toString("hex")}.json`;
  const save = async (result: AtlasRecognition) => {
    // A concurrently deleted book must not leave a fresh private cache behind.
    const exists = await c.env.DB.prepare("SELECT id FROM books WHERE id = ?1 AND user_id = ?2 AND status != 'deleting'").bind(book.id, userId).first();
    if (!exists) throw new HttpError(404, "not_found", "Book not found");
    await c.env.BOOKS.put(key, JSON.stringify({ version: ATLAS_VERSION, result }), { httpMetadata: { contentType: "application/json" } });
    if (!await c.env.DB.prepare("SELECT id FROM books WHERE id = ?1 AND status != 'deleting'").bind(book.id).first()) {
      await c.env.BOOKS.delete(key);
      throw new HttpError(404, "not_found", "Book not found");
    }
  };
  if (!refresh) {
    const cached = await c.env.BOOKS.get(key);
    if (cached) {
      const entry = await cached.json<{ version: string; result: AtlasRecognition }>();
      if (reusableAtlasResult(entry.result, entry.version === ATLAS_VERSION)) return c.json({ ...entry.result, cached: true });
    } else {
      // Migrate the previous path-based cache without another paid inference.
      // Never let an older legacy result override an explicit refresh.
      const legacyKey = `${prefix}${ATLAS_VERSION}/${await sha256Hex(`${file.etag}:${path}`)}.json`;
      const legacy = await c.env.BOOKS.get(legacyKey);
      if (legacy) {
        const result = await legacy.json<AtlasRecognition>();
        if (reusableAtlasResult(result, true)) {
          await save(result);
          return c.json({ ...result, cached: true });
        }
      }
    }
  }
  if (!c.env.DEEPSEEK_API_KEY) throw new HttpError(503, "llm_not_configured", "地图识别服务尚未配置。");
  let work = pending.get(key);
  if (!work) {
    work = (async () => {
      await enforceRateLimit(c.env.DB, `atlas:infer:${userId}`, 6, 60);
      await enforceRateLimit(c.env.DB, `atlas:daily:${userId}`, 40, 86400);
      const result = await recognizeMap(c.env, image, book.title, { operationId: newId(), userId, bookId: book.id });
      await save(result);
      return result;
    })();
    pending.set(key, work);
    c.executionCtx.waitUntil(work.finally(() => pending.delete(key)).catch(() => undefined));
  }
  return c.json(await work);
});
