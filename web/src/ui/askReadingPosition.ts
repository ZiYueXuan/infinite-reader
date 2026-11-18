import type { AskRequest } from '../api/ask'
import type { Chapter } from '../book/types'

/** A selection on the right page takes precedence over the spread's left page. */
export function askReadingPosition(chapters: readonly Chapter[], visible?: { chapter: number; start: number }, selection?: { chapter: number; start: number }): AskRequest['readingPosition'] {
  const position = selection ?? visible
  const chapter = position && chapters[position.chapter]
  if (!position || !chapter) return undefined
  return { chapter: position.chapter, start: position.start, chapterHref: chapter.href, chapterTitle: chapter.title }
}
