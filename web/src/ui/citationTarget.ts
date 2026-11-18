import type { Citation } from '../api/ask'
import type { Locator } from '../book/annotations'
import type { Chapter } from '../book/types'
import { validatePassage } from '../route/passage.ts'

function chapterPath(href: string): string {
  const path = href.split('#')[0]
  try { return decodeURIComponent(path).replace(/^(?:\.\/|\/)+/, '') } catch { return path }
}

function compact(text: string) {
  let value = ''
  const offsets: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (/[\s\u00ad\u200b-\u200d\ufeff]/.test(text[i])) continue
    value += text[i]
    offsets.push(i)
  }
  return { value, offsets }
}

/** The server omits image-only spine items and uses different whitespace from the reader. */
export function citationLocator(citation: Citation, chapters: Chapter[]): Locator | null {
  if (citation.kind === 'web') return null
  const chapter = citation.chapterHref
    ? chapters.findIndex((item) => chapterPath(item.href) === chapterPath(citation.chapterHref!))
    : citation.chapterIndex
  const target = chapters[chapter]
  if (!target || ![citation.charStart, citation.charEnd].every(Number.isSafeInteger) || citation.charStart < 0 || citation.charEnd <= citation.charStart) return null

  const text = compact(target.blocks.map((block) => block.text).join('\n'))
  const snippet = compact(citation.snippet).value
  // Use the longest available quote; a short prefix can still anchor a passage containing omitted markup.
  for (const quote of [snippet, snippet.slice(0, 64)].filter((s) => s.length >= 8)) {
    let closest = -1
    let distance = Infinity
    for (let at = text.value.indexOf(quote); at !== -1; at = text.value.indexOf(quote, at + 1)) {
      const nextDistance = Math.abs(text.offsets[at] - citation.charStart)
      if (nextDistance < distance) { closest = at; distance = nextDistance }
    }
    if (closest !== -1) return { chapter, start: text.offsets[closest], end: text.offsets[closest + quote.length - 1] + 1 }
  }
  const start = Math.min(citation.charStart, Math.max(0, target.textLength - 1))
  return validatePassage({ chapter, start, end: Math.max(start + 1, citation.charEnd) }, chapters)
}
