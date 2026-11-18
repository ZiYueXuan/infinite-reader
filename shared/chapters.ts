/** EPUB spine files and navigation depth alone do not identify semantic chapters. */
interface Entry { title: string; level: number; href?: string }
const numberedChapter = /^(?:第\s*[0-9０-９零〇一二两三四五六七八九十百千]+\s*章|chapter\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b)/i;
// A prologue is a chapter too, including typographic spacing such as 序 章.
const prologue = /^(?:序\s*章|prologue\b)/i;
const section = /^(?:第\s*[^\s]{1,12}\s*节|section\b|\d+\.\d+(?:\D|$))/i;
const part = /^(?:第\s*[^\s]{1,12}\s*[部篇卷]|[上中下][部篇卷](?:\s|$)|(?:part|book|volume)\s+(?:\d+|[ivxlcdm]+|one|two|three)\b)/i;
const matter = /^(?:封面|前言|序言|序章|导言|序|目录|版权|扉页|献词|引言|结语|后记|致谢|附录|参考文献|注释|索引|尾声|跋|关于作者|preface\b|foreword\b|introduction\b|prologue\b|epilogue\b|contents\b|copyright\b|acknowledg|appendi|bibliography\b|notes\b|index\b)/i;
export const isNumberedChapter = (title: string) => numberedChapter.test(title.trim());
export const isChapterBoundary = (title: string) => part.test(title.trim()) || matter.test(title.trim()) || /第\s*[0-9０-９零〇一二两三四五六七八九十百千]+\s*卷$/.test(title.trim());
export function chapterIndices(toc: readonly Entry[]): number[] {
  if (toc.some(e => numberedChapter.test(e.title.trim()))) {
    return toc.flatMap((e, i) => numberedChapter.test(e.title.trim()) || prologue.test(e.title.trim()) ? [i] : []);
  }
  // Unnumbered chapter titles use the first content level, including within named parts.
  // Sections and other front matter remain excluded; prologues stay eligible.
  const candidates = toc.flatMap((e, i) => !section.test(e.title.trim()) && !part.test(e.title.trim()) && (!matter.test(e.title.trim()) || prologue.test(e.title.trim())) ? [i] : []);
  const result: number[] = [];
  const stack: number[] = [];
  for (const i of candidates) {
    while (stack.length && toc[stack.at(-1)!].level >= toc[i].level) stack.pop();
    if (!stack.length) result.push(i);
    stack.push(i);
  }
  return result;
}
/** Includes subordinate sections, even in a flattened NCX, until the next chapter/part/end matter. */
export function chapterEndIndex(toc: readonly Entry[], index: number): number {
  const chapters = new Set(chapterIndices(toc));
  for (let i = index + 1; i < toc.length; i++) {
    const title = toc[i].title.trim();
    if (chapters.has(i) || isChapterBoundary(title) && toc[i].level <= toc[index].level || toc[i].level < toc[index].level) return i;
  }
  return toc.length;
}
