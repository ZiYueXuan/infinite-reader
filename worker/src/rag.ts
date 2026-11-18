import { embedTexts } from "./pipeline";
import type { AiUsageContext } from "./lib/aiUsage";

export interface RetrievedChunk {
  id: string;
  ordinal: number;
  chapterIndex: number;
  chapterTitle: string | null;
  chapterHref: string | null;
  charStart: number;
  charEnd: number;
  text: string;
  score: number;
}

export async function retrieveChunks(
  env: Env,
  bookId: string,
  queryText: string,
  context: AiUsageContext,
  topK = 6,
): Promise<RetrievedChunk[]> {
  const [vec] = await embedTexts(env, [queryText.slice(0, 2000)], { ...context, feature: "retrieval_embedding" });
  const res = await env.VECTORIZE.query(vec!, { topK, namespace: bookId, returnMetadata: "none", returnValues: false });
  const matches = res.matches ?? [];
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.id);
  const rows = await env.DB.prepare(
    `SELECT id, ordinal, chapter_index, chapter_title, chapter_href, char_start, char_end, text
     FROM chunks WHERE book_id = ?1 AND id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(bookId, ...ids)
    .all<{
      id: string;
      ordinal: number;
      chapter_index: number;
      chapter_title: string | null;
      chapter_href: string | null;
      char_start: number;
      char_end: number;
      text: string;
    }>();
  const byId = new Map(rows.results.map((r) => [r.id, r]));
  const out: RetrievedChunk[] = [];
  for (const m of matches) {
    const r = byId.get(m.id);
    if (!r) continue;
    out.push({
      id: r.id,
      ordinal: r.ordinal,
      chapterIndex: r.chapter_index,
      chapterTitle: r.chapter_title,
      chapterHref: r.chapter_href,
      charStart: r.char_start,
      charEnd: r.char_end,
      text: r.text,
      score: m.score,
    });
  }
  return out;
}
