import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LAYOUT, paginate } from './layout.ts'
import type { ParsedBook } from './types.ts'
import { inlineImageFootnotes } from './imageFootnotes.ts'

class MeasuringCanvas {
  getContext() {
    return { font: '16px serif', measureText(text: string) { return { width: text.length * Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16) * .55 } } }
  }
}
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: MeasuringCanvas, configurable: true })

test('image footnotes rejoin only their own source paragraph without changing anchors or illustrations', async () => {
  const note = { id: 'chapter#n', text: 'The image is a reference, not an illustration.' }
  const blocks: ParsedBook['chapters'][number]['blocks'] = [
    { kind: 'p', flowId: 1, start: 0, text: 'Before', runs: [{ text: 'Before' }] },
    { kind: 'img', flowId: 1, start: 7, text: '', runs: [], img: { path: 'note.png', alt: '', footnote: note } },
    { kind: 'p', flowId: 1, start: 8, text: 'After', runs: [{ text: 'After' }] },
    { kind: 'p', flowId: 2, start: 14, text: 'Next paragraph.', runs: [{ text: 'Next paragraph.' }] },
    { kind: 'img', flowId: 2, start: 30, text: '', runs: [], img: { path: 'illustration.png', alt: 'An ordinary image' } },
    { kind: 'img', flowId: 3, start: 31, text: '', runs: [], img: { path: 'last-note.png', alt: '', footnote: note } },
  ]
  const original = JSON.stringify(blocks)
  const display = inlineImageFootnotes(blocks)
  assert.equal(display.length, 4)
  assert.equal(display[0].text, 'Before  After')
  assert.equal(display[1].start, 14)
  assert.equal(display[2], blocks[4], 'ordinary image remains an image')
  assert.equal(display[3].text, '', 'terminal image badge adds no source characters')
  const book: ParsedBook = { meta: { title: 'Image notes', author: '', language: 'en' }, toc: [], getImage: async () => null,
    chapters: [{ index: 0, href: 'chapter', title: '', textLength: 31, blocks }] }
  const pag = await paginate(book, { ...DEFAULT_LAYOUT, pageW: 400, pageH: 600 })
  const words = pag.pages.flatMap(p => p.lines.flatMap(l => l.words))
  assert.equal(words.find(w => w.text === 'After')?.s, 8)
  assert.deepEqual(words.filter(w => w.footnote).map(w => w.s), [7, 31])
  assert.ok(words.filter(w => w.footnote).every(w => w.e <= 31))
  assert.deepEqual(pag.pages.flatMap(p => p.images.map(i => i.path)), ['illustration.png'])
  assert.equal(JSON.stringify(blocks), original, 'parsed source stays immutable')
})

test('footnote badges keep source text, ranges and their preceding word across line widths', async () => {
  const prefix = 'A paragraph leading up to Token'
  const label = '[12]'
  const text = `${prefix}${label} followed by more words and more text.`
  const note = { id: 'notes#12', text: 'A long explanation. '.repeat(80) }
  const book: ParsedBook = {
    meta: { title: 'Footnotes', author: '', language: 'en' }, toc: [], getImage: async () => null,
    chapters: [{ index: 0, href: 'chapter', title: '', textLength: text.length, blocks: [{ kind: 'p', start: 0, text, runs: [{ text: prefix }, { text: label, footnote: note, sup: true }, { text: text.slice(prefix.length + label.length) }] }] }],
  }
  for (const width of [220, 240, 260, 280, 300, 320]) {
    const pag = await paginate(book, { ...DEFAULT_LAYOUT, pageW: width, pageH: 360, marginInner: 30, marginOuter: 30, marginTop: 30, marginBottom: 30 })
    const lines = pag.pages.flatMap(p => p.lines)
    const line = lines.find(l => l.words.some(w => w.footnote))!
    const index = line.words.findIndex(w => w.footnote)
    assert.ok(index > 0, `badge must not start a line at width ${width}`)
    assert.equal(line.words[index - 1].text, 'Token')
    const word = line.words[index]
    assert.equal(word.text, label)
    assert.equal(word.s, prefix.length)
    assert.equal(word.e, prefix.length + label.length + 1, 'trailing source space belongs to the token')
    assert.equal(word.footnote, note)
    assert.ok(word.w < DEFAULT_LAYOUT.fontSize * 1.2, 'long popup text never enters page layout')
    assert.equal(pag.pages[pag.pageForOffset(0, word.s)].chapter, 0)
  }
  assert.equal(book.chapters[0].blocks[0].text, text)
})

test('resolved definitions leave no pages or gaps, preserve source, and navigate back to their reference', async () => {
  const definition = 'A definition that would otherwise fill many pages. '.repeat(100)
  const note = { id: 'notes#1', text: definition }
  const book: ParsedBook = {
    meta: { title: 'Footnotes', author: '', language: 'en' }, toc: [], getImage: async () => null,
    chapters: [
      { index: 0, href: 'notes', title: '', textLength: definition.length, blocks: [{ kind: 'p', start: 0, text: definition, runs: [{ text: definition }], footnoteDefinition: note.id }] },
      { index: 1, href: 'body', title: '', textLength: 50, blocks: [
        { kind: 'p', start: 0, text: 'Token1', runs: [{ text: 'Token' }, { text: '1', footnote: note }] },
        { kind: 'p', start: 7, text: 'An unlinked note stays.', runs: [{ text: 'An unlinked note stays.' }] },
        { kind: 'p', start: 31, text: 'Remaining text.', runs: [{ text: 'Remaining text.' }] },
      ] },
    ],
  }
  const before = JSON.stringify(book)
  const cfg = { ...DEFAULT_LAYOUT, pageW: 320, pageH: 360, marginInner: 30, marginOuter: 30, marginTop: 30, marginBottom: 30 }
  const pag = await paginate(book, cfg)
  assert.equal(JSON.stringify(book), before)
  assert.ok(!pag.pages.some(p => !p.special && p.chapter === 0), 'no empty note-only chapter page')
  assert.ok(pag.pages.flatMap(p => p.lines.flatMap(l => l.words)).some(w => w.text === 'unlinked'))
  assert.equal(pag.pages.flatMap(p => p.lines.flatMap(l => l.words)).find(w => w.text === 'Remaining')?.s, 31)
  const refPage = pag.pageForOffset(1, 5)
  assert.equal(pag.pageForOffset(0, 42), refPage, 'hidden footnote citation maps to visible reference')
  assert.equal(pag.chapterFirstPage[0], refPage)
  const unhidden = { ...book, chapters: structuredClone(book.chapters) }
  delete unhidden.chapters[0].blocks[0].footnoteDefinition
  assert.ok((await paginate(unhidden, cfg)).pages.length > pag.pages.length + 2)
  const annotated = await paginate(book, cfg, undefined, [{ id: 'reader-note', bookId: 'b', kind: 'highlight', color: 'blue', quote: 'definition', createdAt: 1, updatedAt: 1, locator: { chapter: 0, start: 2, end: 12 }, note: { text: 'My existing note', x: 0, y: 0, rot: 0 } }])
  assert.ok(annotated.pages.some(p => p.notes?.some(n => n.id === 'reader-note')), 'existing reader note stays visible')
  assert.equal(annotated.pages[annotated.pageForOffset(0, 4)].chapter, 0)
})
