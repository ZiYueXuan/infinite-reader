import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_LAYOUT, paginate } from './layout.ts'
import { isPhoneDevice, phoneLayout } from './phoneLayout.ts'
import { restoreReadingPosition } from './readingPosition.ts'
import { reflowTarget } from '../engine/reflowTarget.ts'
import type { ParsedBook } from './types.ts'

class MeasuringCanvas {
  getContext() { return { font: '20px serif', measureText(text: string) { return { width: Array.from(text).length * Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 20) } } } }
}
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: MeasuringCanvas, configurable: true })

test('phone identification survives landscape without changing desktops or Android tablets', () => {
  assert.ok(isPhoneDevice('iPhone Mobile', true, 844, 390))
  assert.ok(isPhoneDevice('Android Mobile', true, 360, 800))
  assert.ok(isPhoneDevice('Touch browser', true, 390, 844))
  assert.equal(isPhoneDevice('Macintosh Chrome', false, 390, 844), false)
  assert.equal(isPhoneDevice('Android Tablet', true, 600, 900), false)
})

test('compact iPads share touch reading in both orientations and desktop website mode', () => {
  for (const [width, height] of [[744, 1133], [768, 1024], [756, 1158]]) {
    for (const [w, h] of [[width, height], [height, width]]) {
      assert.ok(isPhoneDevice('iPad Mobile Safari', true, w, h, 5))
      assert.ok(isPhoneDevice('Macintosh Safari', true, w, h, 5))
      assert.ok(isPhoneDevice('Macintosh Safari', false, w, h, 5), 'attaching a trackpad does not disable touch reading')
      assert.equal(isPhoneDevice('Macintosh Safari', false, w, h, 0), false, 'a Mac with the same window size stays a desk')
    }
  }
  for (const [width, height] of [[810, 1080], [820, 1180], [1024, 1366]]) {
    assert.equal(isPhoneDevice('iPad', true, width, height, 5), false)
    assert.equal(isPhoneDevice('Macintosh Safari', true, height, width, 5), false)
  }
})

test('single-page pagination has no blank spread padding, loses no source words and preserves passage anchors', async () => {
  const text = '手机上的阅读应当连贯，翻页之后原文不能遗漏。'.repeat(120)
  const book: ParsedBook = { meta: { title: 'Test', author: '', language: 'zh' }, toc: [], getImage: async () => null,
    chapters: [{ index: 0, title: 'Chapter', href: 'chapter', textLength: text.length, blocks: [{ kind: 'p', text, start: 0, runs: [{ text }] }] }] }
  const desktop = await paginate(book)
  assert.ok(desktop.pages.some(page => page.special === 'blank'))
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [844, 390], [744, 1133], [1133, 744], [768, 1024], [756, 1158]]) {
    const cfg = phoneLayout(DEFAULT_LAYOUT, width, height, 20, 16)
    const pag = await paginate(book, cfg)
    assert.equal(pag.pages.filter(page => page.special === 'title').length, 1)
    assert.equal(pag.pages.filter(page => page.special === 'blank' || page.blank).length, 0)
    const words = pag.pages.flatMap(page => page.lines.flatMap(line => line.words))
    assert.equal(words.map(word => word.text).join(''), text)
    for (const page of pag.pages.filter(page => !page.special)) {
      for (const line of page.lines) {
        assert.ok(line.y + line.h <= height - cfg.marginTop - cfg.marginBottom + 1)
        assert.ok(line.words.every(word => word.x >= -1e-6 && word.x + word.w <= width - cfg.marginInner - cfg.marginOuter + cfg.fontSize + 1e-6), 'only hanging punctuation may enter the margin')
      }
    }
    const source = desktop.pages[4]
    const target = pag.pages[reflowTarget(desktop, pag, [4])]
    assert.ok(target.start <= source.start && target.end >= source.start)
    const position = { leaf: 2, chapter: 0, start: target.start }
    assert.equal(restoreReadingPosition(position, 2, pag), target.index)
    assert.equal(restoreReadingPosition(position, 3, pag), null, 'newer cloud progress takes precedence')
    assert.equal(restoreReadingPosition({ ...position, start: -1 }, 2, pag), null)
  }
})
