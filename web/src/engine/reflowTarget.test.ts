import assert from 'node:assert/strict'
import test from 'node:test'
import { reflowTarget } from './reflowTarget.ts'
import type { Page, PlacedInlineNote } from '../book/layout.ts'

const note = (id: string): PlacedInlineNote => ({
  id, locator: { chapter: 0, start: 10, end: 20 }, x: 0, y: 0, w: 400, h: 100,
  lines: [], continued: true, continues: true, textColor: 'default',
})
const page = (index: number, notes: PlacedInlineNote[] = [], original = false): Page => ({
  index, chapter: 0, chapterTitle: '', notes, images: [], rules: [], start: 20, end: original ? 50 : 20,
  chapterStart: false, label: String(index), lines: original ? [{ y: 0, h: 33, baseline: 22,
    words: [{ text: 'Original', x: 0, w: 80, font: '22px serif', s: 20, e: 28, space: false, size: 22 }],
  }] : [],
})

test('font reflow preserves the visible continuation ordinal when a note spans several pages', () => {
  const previous = { pages: [page(0, [], true), page(1, [note('a')]), page(2, [note('a')]), page(3, [note('a')]), page(4, [], true)] }
  const next = { pages: [page(0, [], true), page(1, [], true), page(2, [note('a')]), page(3, [note('b')]), page(4, [note('a')]), page(5, [note('a')])], pageForOffset: () => 0 }
  assert.equal(reflowTarget(previous, next, [3, 4]), 5)
  assert.equal(reflowTarget(previous, next, [3, 4], 'a'), 2, 'explicit editing opens the first fragment')
})

test('shortened notes retain the last available continuation and deleted notes fall back to original text', () => {
  const previous = { pages: [page(0, [note('a')]), page(1, [note('a')]), page(2, [note('a')]), page(3, [note('a')])] }
  const next = { pages: [page(0, [], true), page(1, [note('a')]), page(2, [note('a')])], pageForOffset: (chapter: number, offset: number) => { assert.equal(chapter, 0); assert.equal(offset, 20); return 0 } }
  assert.equal(reflowTarget(previous, next, [3, -1]), 2)
  assert.equal(reflowTarget(previous, { ...next, pages: [page(0, [], true)] }, [3, -1]), 0)
})

test('a mixed original-and-note page retains the original passage, and covers remain covers', () => {
  const previous = { pages: [page(0, [note('a')], true), { ...page(1), special: 'blank' as const }] }
  const next = { pages: [page(0, [note('a')]), page(1, [], true)], pageForOffset: () => 1 }
  assert.equal(reflowTarget(previous, next, [0, 1]), 1)
  assert.equal(reflowTarget(previous, next, [-1, 1]), 0)
})
