import type { Page, Paginated } from '../book/layout'

/** Preserve either the original passage or the continuation being read on a note-only page. */
export function reflowTarget(
  previous: Pick<Paginated, 'pages'>,
  next: Pick<Paginated, 'pages' | 'pageForOffset'>,
  visible: readonly number[],
  noteId?: string,
): number {
  // Explicit editing/navigation starts at the note's first fragment.
  const requested = noteId ? next.pages.find((page) => page.notes?.some((note) => note.id === noteId)) : undefined
  if (requested) return requested.index

  const oldPage = visible.map((i) => previous.pages[i]).find((page): page is Page => !!page && !page.special && !page.blank)
  if (!oldPage) return 0
  const note = oldPage.notes?.[0]
  const hasOriginalText = oldPage.lines.some((line) => line.words.some((word) => word.s >= 0))
  if (note && !hasOriginalText) {
    const oldFragments = previous.pages.flatMap((page) => (page.notes ?? []).filter((part) => part.id === note.id))
    const ordinal = Math.max(0, oldFragments.indexOf(note))
    const nextFragments = next.pages.flatMap((page) => (page.notes ?? []).filter((part) => part.id === note.id).map(() => page.index))
    // A new font or a shorter edit may reduce the fragment count. Stay on its last
    // remaining fragment, instead of jumping back to the original quoted sentence.
    if (nextFragments.length) return nextFragments[Math.min(ordinal, nextFragments.length - 1)]
  }
  return next.pageForOffset(oldPage.chapter, oldPage.start)
}
