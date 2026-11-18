import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ellipsizeNoteText, noteFont, wrapNoteText } from './noteText.ts'

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const measure = (text: string) => Array.from(segments.segment(text)).length

test('Chinese note wraps without losing its closing quote or exclamation', () => {
  const text = '注意：这里说的是“力量”，而不是“智慧”！'
  const lines = wrapNoteText(text, 9, measure)
  assert.ok(lines.length > 1)
  assert.equal(lines.join(''), text)
  for (const line of lines) {
    assert.ok(measure(line) <= 9)
    assert.doesNotMatch(line, /^[，。”！]/)
    assert.doesNotMatch(line, /“$/)
  }
})

test('English words, explicit paragraphs and oversized tokens wrap', () => {
  assert.deepEqual(wrapNoteText('this is a note\n\nnext line', 9, measure), ['this is a', 'note', '', 'next line'])
  const text = 'averylongwordwithoutspaces'
  const lines = wrapNoteText(text, 8, measure)
  assert.equal(lines.join(''), text)
  assert.ok(lines.every((line) => measure(line) <= 8))
})

test('grapheme-safe wrapping and ellipsis retain emoji and combining marks', () => {
  const text = '你好👨‍👩‍👧‍👦é世界'
  assert.equal(wrapNoteText(text, 3, measure).join(''), text)
  assert.equal(ellipsizeNoteText(text, 5, measure), '你好👨‍👩‍👧‍👦é…')
  assert.equal(ellipsizeNoteText('中文没有空格', 5, measure), '中文没有…')
})

test('Chinese note uses one Chinese face for text and punctuation', () => {
  assert.equal(noteFont('“智慧”！').weight, 500)
  assert.match(noteFont('“智慧”！').family, /^"LXGW WenKai"/)
  assert.match(noteFont('this is a note').family, /^"Caveat Variable"/)
})
