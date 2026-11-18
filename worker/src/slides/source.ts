import { chapterIndices, isChapterBoundary, isNumberedChapter } from '../../../shared/chapters';
import { htmlToText, parseEpub } from '../pipeline/epub';
import { position } from '../mindmap/source';
import { HttpError } from '../lib/util';

export function slidesSource(bytes: Uint8Array, target: string) {
  const parsed = parseEpub(bytes, { includeSource: true, skipCover: true });
  const toc = parsed.toc;
  const index = chapterIndices(toc).find(i => toc[i].href === target) ?? -1;
  if (!chapterIndices(toc).includes(index)) throw new HttpError(422, 'slides_not_chapter', 'Slides are available for chapters only.');
  // Some EPUBs point chapter entries at a copyright page. Repair only when an
  // exact, isolated numbered heading occurs uniquely in the body (never a TOC link).
  const numberedTitles = new Set(toc.filter(t => isNumberedChapter(t.title)).map(t => t.title.replace(/\s/g, '')));
  const headings = new Map<string, { chapter: number; offset: number }[]>();
  parsed.chapters.forEach((ch, chapter) => {
    for (const match of ch.html!.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
      if (/<a\b/i.test(match[2])) continue;
      const title = htmlToText(match[2]).replace(/\s/g, '');
      if (numberedTitles.has(title)) headings.set(title, [...(headings.get(title) ?? []), { chapter, offset: match.index! }]);
    }
  });
  const locate = (i: number) => {
    const matches = headings.get(toc[i].title.replace(/\s/g, ''));
    return matches?.length === 1 ? matches[0] : position(parsed.chapters, toc[i].href);
  };
  const start = locate(index);
  const boundaries = new Set(chapterIndices(toc));
  const after = (p: { chapter: number; offset: number }) => p.chapter > start.chapter || p.chapter === start.chapter && p.offset > start.offset;
  const ends = toc.flatMap((entry, i) => {
    if (i === index || !(boundaries.has(i) || entry.level < toc[index].level || entry.level <= toc[index].level && isChapterBoundary(entry.title))) return [];
    const p = locate(i);
    return after(p) ? [p] : [];
  }).sort((a, b) => a.chapter - b.chapter || a.offset - b.offset);
  const end = ends[0] ?? { chapter: parsed.chapters.length, offset: 0 };
  if (end.chapter < start.chapter || end.chapter === start.chapter && end.offset <= start.offset) throw new HttpError(422, 'slides_order', 'Chapter boundaries could not be determined.');
  const parts: string[] = [];
  for (let i = start.chapter; i <= end.chapter && i < parsed.chapters.length; i++) {
    const ch = parsed.chapters[i], html = ch.html!;
    // Calibre often appends a volume's hundreds of standalone endnote files to
    // its last chapter. Backlink-only notes and navigation pages are not prose.
    if (/^(?:描述\s*)?\[\s*[←↩]\s*\d+\]/.test(ch.text) && /<a\b[^>]*href=/i.test(html)) continue;
    if (/^(?:Table of Contents|目录)\s*\n/i.test(ch.text) && (html.match(/<a\b/gi)?.length ?? 0) > 3) continue;
    let slice = html.slice(i === start.chapter ? start.offset : 0, i === end.chapter ? end.offset : html.length);
    for (const note of slice.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) {
      if (/^\[\s*[←↩]\s*\d+\]/.test(htmlToText(note[1])) && /<a\b[^>]*href=/i.test(note[1])) { slice = slice.slice(0, note.index); break; }
    }
    parts.push(htmlToText(slice.replace(/<\/?body\b[^>]*>/gi, '')));
  }
  const text = parts.join('\n\n').trim();
  if (text.length < 30) throw new HttpError(422, 'slides_empty', 'This chapter has too little text to make slides.');
  if (text.length > 1_200_000) throw new HttpError(422, 'slides_too_long', 'This chapter exceeds the current slides limit.');
  return { title: toc[index].title, parts: splitChapter(text) };
}
export function splitChapter(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 24_000, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n', end);
      if (paragraph > start + 12_000) end = paragraph + 1;
      // Do not split a surrogate pair.
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
