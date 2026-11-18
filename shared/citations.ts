export interface BookCitation {
  kind?: 'book'
  n: number; chunkId: string; ordinal: number; chapterIndex: number; chapterTitle: string | null
  chapterHref: string | null; charStart: number; charEnd: number; snippet: string; score: number
}
export interface WebCitation {
  kind: 'web'
  n: number; url: string; title: string; snippet: string; retrievedAt: number
}
export type Citation = BookCitation | WebCitation

/** Search results are links, never application navigation or executable URLs. */
export function webSourceUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
