// Import inside Vite. Compare incremental note layout with independent full pagination.
import { paginate, DEFAULT_LAYOUT } from '../src/book/layout.ts'

export async function checkNoteChapterLayout() {
  const text = 'A long paragraph preserves source offsets while inline notes change the page flow. '.repeat(50)
  const chapters = Array.from({ length: 24 }, (_, index) => ({ index, title: `Chapter ${index}`, href: `${index}.xhtml`, textLength: text.length,
    blocks: [{ kind: 'p', text, start: 0, runs: [{ text }] }] }))
  chapters[0].blocks.push({ kind: 'p', text: '1', start: text.length + 1, runs: [{ text: '1', footnote: { id: 'fn', text: 'Hidden definition.' } }] })
  chapters[0].textLength += 2
  chapters.push({ index: 24, title: 'Definitions', href: 'notes.xhtml', textLength: 18,
    blocks: [{ kind: 'p', text: 'Hidden definition.', start: 0, runs: [{ text: 'Hidden definition.' }], footnoteDefinition: 'fn' }] })
  const book = { meta: { title: 'Incremental fixture', author: 'Test', language: 'en' }, chapters, toc: [], getImage: async () => null }
  const note = (id, chapter, text) => ({ id, bookId: 'fixture', locator: { chapter, start: 5, end: 15 }, quote: 'fixture', kind: 'highlight', color: 'pink',
    createdAt: 1, updatedAt: 1, note: { text, font: 'inherit', x: 0, y: 0, rot: 0 } })
  const a = note('a', 4, 'A short note.'), b = note('b', 17, 'An independent note.')
  let previous = await paginate(book), checks = 0
  const verify = async (annotations, cfg = DEFAULT_LAYOUT, requireReuse = true) => {
    const old = JSON.stringify(previous.pages)
    const next = await paginate(book, cfg, undefined, annotations, previous)
    const full = await paginate(book, cfg, undefined, annotations)
    if (JSON.stringify(next.pages) !== JSON.stringify(full.pages)) throw new Error('Incremental pages differ from full layout')
    if (JSON.stringify(next.chapterFirstPage) !== JSON.stringify(full.chapterFirstPage)) throw new Error('Chapter navigation differs')
    if (next.noteSignature !== full.noteSignature) throw new Error('Note snapshot differs')
    for (const ch of chapters) for (const offset of [0, 8, 15, Math.floor(ch.textLength / 2), ch.textLength - 1]) {
      if (next.pageForOffset(ch.index, offset) !== full.pageForOffset(ch.index, offset)) throw new Error('Source/footnote lookup differs')
    }
    if (JSON.stringify(previous.pages) !== old) throw new Error('Previous pagination was mutated')
    const unaffected = next.pages.find(p => p.chapter === 10 && p.chapterStart)
    const oldUnaffected = previous.pages.find(p => p.chapter === 10 && p.chapterStart)
    if ((unaffected.lines === oldUnaffected.lines) !== requireReuse) throw new Error('Incorrect chapter reuse/invalidation')
    previous = next; checks++
  }
  await verify([a])
  await verify([a, b])
  await verify([{ ...a, note: { ...a.note, text: 'A long note continuation. '.repeat(300) } }, b])
  await verify([{ ...a, note: { ...a.note, text: '**Markdown** with a list\n\n- first\n- second', tags: ['review'] } }, b])
  await verify([b]) // Remove and renumber later pages without mutating old snapshots.
  await verify([])
  await verify([note('definition', 24, 'Annotating a hidden definition makes it visible.')], DEFAULT_LAYOUT, false)
  await verify([], DEFAULT_LAYOUT, false) // Removing it restores hidden-definition navigation.
  await verify([a], { ...DEFAULT_LAYOUT, fontSize: DEFAULT_LAYOUT.fontSize + 2 }, false)
  return { checks, pages: previous.pages.length }
}
