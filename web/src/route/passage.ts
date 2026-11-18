import type { Locator } from '../book/annotations'
import type { Chapter } from '../book/types'
import { pathForBook } from './bookPath.ts'

/** Character offsets survive pagination and zoom changes; page numbers do not. */
export function pathForPassage(bookId: string, loc: Locator): string {
  return `${pathForBook(bookId)}#passage=${loc.chapter}:${loc.start}:${loc.end}`
}

export function passageFromHash(hash: string): Locator | null {
  const match = /^#passage=(\d+):(\d+):(\d+)$/.exec(hash)
  if (!match) return null
  const [chapter, start, end] = match.slice(1).map(Number)
  if (![chapter, start, end].every(Number.isSafeInteger) || end <= start) return null
  return { chapter, start, end }
}

export function validatePassage(loc: Locator, chapters: Pick<Chapter, 'textLength'>[]): Locator | null {
  if (![loc.chapter, loc.start, loc.end].every(Number.isSafeInteger) || loc.chapter < 0 || loc.start < 0 || loc.end <= loc.start) return null
  const chapter = chapters[loc.chapter]
  if (!chapter) return null
  const length = chapter.textLength
  // Image-only chapters still have a page to navigate to, but no text to highlight.
  if (length === 0) return loc.start === 0 ? { chapter: loc.chapter, start: 0, end: 1 } : null
  if (loc.start >= length) return null
  return { ...loc, end: Math.min(loc.end, length) }
}
