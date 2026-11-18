import type { Paginated } from './layout'

export interface ReadingPosition { leaf: number; chapter: number; start: number; title?: boolean }

/** Device-local precision, accepted only while the existing cloud progress still agrees. */
export function restoreReadingPosition(value: unknown, leaf: number, pag: Paginated): number | null {
  if (!value || typeof value !== 'object') return null
  const p = value as ReadingPosition
  if (p.leaf !== leaf || !Number.isInteger(p.chapter) || !Number.isInteger(p.start) || p.chapter < 0 || p.start < 0) return null
  if (p.title === true) return 0
  if (!pag.pages.some(page => !page.special && page.chapter === p.chapter && page.start <= p.start && page.end >= p.start)) return null
  return pag.pageForOffset(p.chapter, p.start)
}

export function phonePositionKey(scope: string, book: string) { return `ir:phone-position:${scope}:${book}` }
