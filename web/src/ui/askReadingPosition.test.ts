import assert from 'node:assert/strict'
import test from 'node:test'
import { askReadingPosition } from './askReadingPosition.ts'
import type { Chapter } from '../book/types'

const chapters = [{ index: 0, title: 'Left', href: 'OEBPS/left.xhtml' }, { index: 1, title: 'Right', href: 'OEBPS/right.xhtml' }] as Chapter[]
test('selection location wins over a different visible left chapter', () => {
  assert.deepEqual(askReadingPosition(chapters, { chapter: 0, start: 0 }, { chapter: 1, start: 9420 }),
    { chapter: 1, start: 9420, chapterHref: 'OEBPS/right.xhtml', chapterTitle: 'Right' })
})
test('without a selection use the visible passage; covers have no chapter context', () => {
  assert.equal(askReadingPosition(chapters, { chapter: 0, start: 50 })?.start, 50)
  assert.equal(askReadingPosition(chapters, { chapter: -1, start: 0 }), undefined)
})
