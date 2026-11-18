import { inferFlatTocLevels } from '../../../shared/tocHierarchy';
import { decodeEntities, htmlToText, parseEpub, type ParsedChapter } from '../pipeline/epub';
import { HttpError } from '../lib/util';

export function position(chapters: ParsedChapter[], href: string) {
  const hash = href.indexOf('#');
  const path = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 ? '' : href.slice(hash + 1);
  const chapter = chapters.findIndex(c => c.href === path);
  if (chapter < 0) throw new HttpError(422, 'mindmap_target', '无法定位该目录的正文。');
  const html = chapters[chapter].html!;
  if (!fragment) return { chapter, offset: 0 };
  // Match IDs as attribute values, never interpolate an EPUB fragment into a regex.
  for (const match of html.matchAll(/<[A-Za-z][^>]*>/g)) {
    for (const attr of match[0].matchAll(/\s(?:id|xml:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      if (decodeEntities(attr[1] ?? attr[2]) === fragment) return { chapter, offset: match.index! };
    }
  }
  throw new HttpError(422, 'mindmap_anchor', '无法定位该节的起止位置，尚未调用 AI。');
}

/** Resolve owned archive navigation on the server; never trust client-supplied book text. */
export function mindmapSource(bytes: Uint8Array, target: string) {
  const parsed = parseEpub(bytes, { includeSource: true });
  const entries = parsed.toc.length ? parsed.toc : parsed.chapters.map(c => ({ href: c.href, title: c.title, level: 0 }));
  const toc = inferFlatTocLevels(entries);
  const index = toc.findIndex(t => t.href === target);
  if (index < 0) throw new HttpError(422, 'mindmap_target', '该目录不在原书中，请重新打开书籍。');
  const item = toc[index], start = position(parsed.chapters, item.href);
  const next = toc.slice(index + 1).find(t => t.level <= item.level && t.href !== item.href);
  const end = next ? position(parsed.chapters, next.href) : { chapter: parsed.chapters.length, offset: 0 };
  if (end.chapter < start.chapter || end.chapter === start.chapter && end.offset <= start.offset) {
    throw new HttpError(422, 'mindmap_order', '目录顺序无法确定，尚未调用 AI。');
  }
  const parts: string[] = [];
  for (let i = start.chapter; i <= end.chapter && i < parsed.chapters.length; i++) {
    const html = parsed.chapters[i].html!;
    const slice = html.slice(i === start.chapter ? start.offset : 0, i === end.chapter ? end.offset : html.length);
    // Remove a partial body wrapper before conversion, preserving content across fragment boundaries.
    parts.push(htmlToText(slice.replace(/<\/?body\b[^>]*>/gi, '')));
  }
  const text = parts.join('\n\n').trim();
  if (text.length < 30) throw new HttpError(422, 'mindmap_empty', '该目录没有足够的正文可生成思维导图。');
  // Fail before billing instead of silently summarizing only the beginning of a long chapter.
  if (text.length > 100_000) throw new HttpError(422, 'mindmap_too_long', '本章内容较长，请先为其下各节生成思维导图。');
  return { title: item.title, text };
}

/** The stored quote is immutable; color/note/tag edits must reuse the same map. */
export function annotationMindmapSource(id: string, quote: string | null) {
  const text = quote?.trim() ?? '';
  if (!text) throw new HttpError(422, 'mindmap_empty', '这条划线没有可供生成思维导图的文字。');
  if (text.length > 20_000) throw new HttpError(422, 'mindmap_too_long', '划线内容过长，请选择较短的段落。');
  const characters = Array.from(text.replace(/\s+/g, ' '));
  return { title: characters.slice(0, 60).join('') + (characters.length > 60 ? '…' : ''), text, source: { annotationId: id, quote: text } };
}
