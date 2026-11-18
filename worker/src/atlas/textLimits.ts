import { HttpError, rateLimit } from '../lib/util';

export const TEXT_MAP_DAILY_LIMIT = 120;
export const TEXT_MAP_MINUTE_LIMIT = 6;

export async function enforceTextMapReadLimit(db: D1Database, userId: string) {
  const r = await rateLimit(db, `text-atlas:read:${userId}`, 120, 60);
  if (!r.ok) throw new HttpError(429, 'text_atlas_read_limit', '地图请求过于频繁，请等待后重试。', { retryAfter: r.retryAfter });
}

/** Called only after claiming a new inference; cached maps never reserve quota. */
export async function enforceTextMapGenerationLimit(db: D1Database, userId: string) {
  const minute = await rateLimit(db, `text-atlas:infer:${userId}`, TEXT_MAP_MINUTE_LIMIT, 60);
  if (!minute.ok) throw new HttpError(429, 'text_atlas_minute_limit', '地点识别每分钟最多 6 次，请等待后重试。', { retryAfter: minute.retryAfter });
  const now = Date.now(), day = 86400_000, start = Math.floor(now / day) * day;
  // Seed the replacement counter from the usage ledger, not the old counter,
  // which counted rejected requests too. The conditional upsert is atomic.
  const row = await db.prepare(`
    INSERT INTO rate_limits (key, window_start, count)
    SELECT ?1, ?2, used + 1 FROM (
      SELECT COUNT(*) AS used FROM ai_usage
      WHERE user_id = ?3 AND feature = 'text_atlas' AND started_at >= ?2 AND started_at < ?4
    ) WHERE used < ?5
    ON CONFLICT(key, window_start) DO UPDATE SET count = rate_limits.count + 1
      WHERE rate_limits.count < ?5
    RETURNING count
  `).bind(`text-atlas:daily:v2:${userId}`, start, userId, start + day, TEXT_MAP_DAILY_LIMIT).first();
  if (!row) throw new HttpError(429, 'text_atlas_daily_limit', '今日地点识别已达 120 次上限。已有地图仍可查看。', {
    retryAfter: Math.max(1, Math.ceil((start + day - now) / 1000)), resetAt: start + day, limit: TEXT_MAP_DAILY_LIMIT,
  });
}
