import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LAYOUT, paginate } from './layout.ts'
import { rangeRects } from './pageRender.ts'
import type { Block, ParsedBook } from './types.ts'

class MeasuringCanvas {
  getContext() {
    return { font: '16px serif', measureText(text: string) { return { width: Array.from(text).length * Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16) } } }
  }
}
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: MeasuringCanvas, configurable: true })

const cfg = { ...DEFAULT_LAYOUT, pageW: 360, pageH: 330, marginTop: 30, marginBottom: 30, marginInner: 30, marginOuter: 30, fontSize: 16 }
function fixture() {
  let offset = 0
  const block = (text: string, kind: Block['kind'], literary?: Block['literary']): Block => {
    const result = { kind, literary, text, runs: [{ text }], start: offset }
    offset += text.length + 1
    return result
  }
  const blocks = [
    block('这是引用之前的正文。', 'p'),
    block('这是跨页的原书引用，应该保持背景和左侧竖线。'.repeat(18), 'quote', { role: 'quote', group: 1, first: true, last: true }),
    block('这是引用之后的正文。', 'p'),
    block('章首题辞保留原本的文学排版。', 'quote', { role: 'epigraph', group: 2, first: true, last: true }),
    block('一行诗句。', 'p', { role: 'verse', group: 3, first: true, last: true }),
  ]
  const book: ParsedBook = { meta: { title: 'Quotes', author: '', language: 'zh' }, toc: [], getImage: async () => null,
    chapters: [{ index: 0, href: 'chapter', title: '', blocks, textLength: offset - 1 }] }
  return { book, quote: blocks[1] }
}

test('source quotes decorate every page fragment without changing source anchors or ordinary text', async () => {
  const { book, quote } = fixture(), source = JSON.stringify(book)
  const pag = await paginate(book, cfg)
  const end = quote.start + quote.text.length
  const quotePages = pag.pages.filter(p => rangeRects(p, quote.start, end).length)
  assert.ok(quotePages.length > 1, 'fixture must span pages')
  for (const page of pag.pages) for (const line of page.lines) {
    const isQuote = line.words.some(w => w.s >= quote.start && w.s < end)
    assert.equal(!!line.quoteDecoration, isQuote, 'ordinary paragraphs, epigraphs and verse have no quote wash')
    if (!isQuote) continue
    const d = line.quoteDecoration!
    assert.ok(d.x >= 0 && d.x + d.w <= cfg.pageW - cfg.marginInner - cfg.marginOuter)
    assert.ok(d.x < line.words[0].x, 'rule must sit outside text')
    assert.ok(line.y >= 0 && line.y + line.h <= cfg.pageH - cfg.marginTop - cfg.marginBottom + 0.5)
    for (const w of line.words) {
      assert.equal(quote.text.slice(w.s - quote.start, w.e - quote.start), w.text)
      assert.equal(pag.pageForOffset(0, w.s), page.index)
    }
  }
  assert.equal(JSON.stringify(book), source)
  const cached = await paginate(book, cfg, undefined, [], pag)
  assert.deepEqual(cached.pages, pag.pages, 'cached chapters retain quote decorations')
})

test('an inline note inside a quote separates its decorations and preserves source selection', async () => {
  const { book, quote } = fixture()
  const locator = { chapter: 0, start: quote.start, end: quote.start + 18 }
  const pag = await paginate(book, cfg, undefined, [{ id: 'note', bookId: 'fixture', locator, quote: quote.text.slice(0, 18),
    kind: 'highlight', color: 'blue', createdAt: 1, updatedAt: 1, note: { text: '自己的笔记。'.repeat(10), x: 0, y: 0, rot: 0 } }])
  assert.ok(pag.pages.some(p => p.notes?.length))
  for (const page of pag.pages) for (const note of page.notes ?? []) {
    assert.ok(note.lines.every(l => !l.quoteDecoration), 'source quote styling never decorates reader notes')
    for (const line of page.lines.filter(l => l.quoteDecoration)) {
      assert.ok(line.y + line.h <= note.y || line.y >= note.y + note.h, 'quote wash/rule does not cross inserted notes')
    }
  }
  assert.ok(pag.pages.flatMap(p => rangeRects(p, locator.start, locator.end)).length)
})

test('quote family is independent, inherits when unset, and invalidates cached layout', async () => {
  const { book, quote } = fixture()
  const text = quote.text
  quote.runs = [{ text: text.slice(0, 10) }, { text: text.slice(10, 20), mono: true }, { text: text.slice(20) }]
  const config = { ...cfg, family: 'Body Serif', quoteFamily: 'Quote Kai' }
  const before = JSON.stringify(book)
  const styled = await paginate(book, config)
  for (const word of styled.pages.flatMap(p => p.lines.flatMap(l => l.words))) {
    if (word.s >= quote.start && word.s < quote.start + quote.text.length) {
      const prose = word.s < quote.start + 10 || word.s >= quote.start + 20
      assert.ok(word.font.includes(prose ? 'Quote Kai' : 'monospace'))
      assert.equal(word.font.startsWith('italic '), prose, 'quoted prose defaults to italic; explicit code stays upright')
    } else {
      assert.ok(word.font.includes('Body Serif'), 'ordinary prose, verse and epigraphs retain body family')
      assert.ok(!word.font.startsWith('italic '), 'quote italics do not affect surrounding content')
    }
  }
  const inherited = await paginate(book, { ...config, quoteFamily: undefined }, undefined, [], styled)
  assert.ok(inherited.pages.flatMap(p => p.lines.flatMap(l => l.words)).every(w => !w.font.includes('Quote Kai')))
  assert.ok(inherited.pages.flatMap(p => p.lines.flatMap(l => l.words)).filter(w => w.s >= quote.start && w.s < quote.start + 10).every(w => w.font.startsWith('italic ')), 'following the body font retains quote italics')
  const note = { id: 'note', bookId: 'fixture', locator: { chapter: 0, start: quote.start, end: quote.start + 5 }, quote: '',
    kind: 'highlight' as const, color: 'blue' as const, createdAt: 1, updatedAt: 1,
    note: { text: '这段是笔记而不是引文。', font: 'inherit' as const, x: 0, y: 0, rot: 0 } }
  const withNote = await paginate(book, config, undefined, [note], styled)
  const noteWords = withNote.pages.flatMap(p => (p.notes ?? []).flatMap(n => n.lines.flatMap(l => l.words)))
  assert.ok(noteWords.length > 0 && noteWords.every(w => w.font.includes('Body Serif')))
  assert.equal(JSON.stringify(book), before)
})

test('separate consecutive quote wrappers do not stack outer margins', async () => {
  const { book } = fixture()
  let start = 0
  const texts = ['前文。', '生死向前去，打狼保村庄，', '兄弟血如海，姐妹尸如霜。', '豺狼纵凶狠，我们不退让，', '情愿打狼死，不能没家乡！', '后文。']
  const blocks: Block[] = texts.map((text, i) => {
    const quote = i > 0 && i < texts.length - 1
    const block: Block = { kind: quote ? 'quote' : 'p', text, runs: [{ text }], start,
      literary: quote ? { role: 'quote', group: i, first: true, last: true } : undefined }
    start += text.length + 1
    return block
  })
  book.chapters[0] = { ...book.chapters[0], blocks, textLength: start - 1 }
  const source = JSON.stringify(book)
  for (const fontSize of [16, 24]) {
    const pag = await paginate(book, { ...cfg, fontSize, pageW: 800, pageH: 900 })
    const lines = pag.pages.flatMap(p => p.lines)
    assert.equal(lines.length, texts.length)
    const quoteLines = lines.slice(1, -1)
    assert.ok(quoteLines.every(l => l.h < lines[0].h && l.quoteDecoration))
    for (let i = 1; i < quoteLines.length; i++) {
      const gap = quoteLines[i].y - quoteLines[i - 1].y - quoteLines[i - 1].h
      assert.ok(gap >= 0 && gap <= fontSize * 0.17, 'adjacent wrappers have only a small paragraph gap')
    }
    assert.ok(quoteLines[0].y - lines[0].y - lines[0].h > fontSize * 0.5, 'keep separation from preceding prose')
    assert.ok(lines.at(-1)!.y - quoteLines.at(-1)!.y - quoteLines.at(-1)!.h > fontSize, 'keep separation from following prose')
  }
  assert.equal(JSON.stringify(book), source)
})
