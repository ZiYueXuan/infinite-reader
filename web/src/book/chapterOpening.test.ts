import assert from 'node:assert/strict'
import { test } from 'node:test'
import { annotateChapterOpening } from './typography.ts'
import { DEFAULT_LAYOUT, paginate } from './layout.ts'
import type { Block, ParsedBook } from './types.ts'

class MeasuringCanvas {
  getContext() {
    return { font: '16px serif', measureText(text: string) { return { width: Array.from(text).length * Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16) } } }
  }
}
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: MeasuringCanvas, configurable: true })
const paragraph = (text: string, start: number, align: Block['align']): Block => ({ kind: 'p', text, start, align, runs: [{ text }], ids: [`p${start}`] })
function fixture(): Block[] {
  return [
    { kind: 'img', text: '', runs: [], start: 0, img: { path: 'opener.jpg', alt: '' } },
    paragraph('第一章', 1, 'center'), paragraph('最后关头', 5, 'right'),
  ]
}

test('standalone chapter pairs gain presentation roles without rewriting source data', () => {
  const blocks = fixture(), original = structuredClone(blocks)
  annotateChapterOpening(blocks)
  assert.equal(blocks[1].chapterHeading, 'number')
  assert.equal(blocks[2].chapterHeading, 'title')
  assert.deepEqual(blocks.map(({ chapterHeading: _role, ...rest }) => rest), original)
  for (const other of [
    [...fixture(), paragraph('正文不能被当作章扉页。', 10, 'left')],
    [fixture()[0], paragraph('一座古桥', 1, 'center'), paragraph('照片摄于1937年。', 7, 'right')],
    [paragraph('第一节', 0, 'center'), paragraph('最后关头', 4, 'right')],
    [paragraph('第一章', 0, 'center'), { ...paragraph('最后关头', 4, 'right'), literary: { role: 'quote' as const, group: 1 } }],
  ]) {
    annotateChapterOpening(other)
    assert.ok(other.every(b => !b.chapterHeading), 'body text, captions, sections and quotations keep source styling')
  }
})

test('chapter image, number and prominent centered title fit together at varied reading sizes', async () => {
  const blocks = fixture()
  annotateChapterOpening(blocks)
  const book: ParsedBook = { meta: { title: 'Book', author: '', language: 'zh' }, toc: [], getImage: async () => null,
    chapters: [{ index: 0, href: 'chapter', title: '', blocks, textLength: 9 }] }
  const original = JSON.stringify(book)
  for (const fontSize of [16, 24, 32]) {
    const cfg = { ...DEFAULT_LAYOUT, fontSize, pageW: 360, pageH: 420, marginInner: 30, marginOuter: 30, marginTop: 30, marginBottom: 30 }
    const pages = (await paginate(book, cfg)).pages.filter(p => p.chapter === 0 && !p.special)
    assert.equal(pages.length, 1, 'reserve title space when sizing the image')
    const page = pages[0], [number, title] = page.lines
    assert.equal(page.images.length, 1)
    assert.equal(page.lines.length, 2)
    assert.ok(title.words[0].size > number.words[0].size * 1.5)
    for (const line of page.lines) {
      const first = line.words[0], last = line.words.at(-1)!
      assert.ok(Math.abs((first.x + last.x + last.w) / 2 - 150) < 1, 'both lines share the page center')
      assert.ok(line.y + line.h <= 360)
    }
    assert.ok(number.y > page.images[0].y + page.images[0].h)
  }
  assert.equal(JSON.stringify(book), original)
})
