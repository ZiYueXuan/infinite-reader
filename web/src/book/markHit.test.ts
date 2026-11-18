import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Annotation } from './annotations.ts'
import type { Line, Page, Word } from './layout.ts'
import { localInProjectedBox } from '../engine/projectedBox.ts'
import { markBand, markUnderPoint } from './pageRender.ts'

const fontSize = 22
const lineH = fontSize * 1.5 * 1.16
const baseline = lineH * 0.5 + fontSize * 0.32

function word(text: string, x: number, s: number): Word {
  return { text, x, w: fontSize, font: '22px serif', s, e: s + text.length, space: false, size: fontSize }
}

function line(y: number, words: Word[]): Line {
  return { y, h: lineH, baseline, words }
}

function page(lines: Line[]): Page {
  const start = lines[0]?.words[0]?.s ?? 0
  const last = lines.at(-1)?.words.at(-1)
  return {
    index: 2,
    chapter: 1,
    chapterTitle: '',
    lines,
    images: [],
    rules: [],
    start,
    end: last ? last.e : start,
    chapterStart: false,
    label: '2',
  }
}

function mark(start: number, end: number, kind: Annotation['kind'] = 'highlight'): Annotation {
  return {
    id: 'm', bookId: 'b', locator: { chapter: 1, start, end }, quote: '', kind, color: 'violet', createdAt: 1, updatedAt: 1,
  }
}

test('a click on the highlight wash is the mark, and the cream gap around it is not', () => {
  const row = line(100, [word('没', 10, 18), word('有', 40, 19)])
  const body = page([row])
  const band = markBand(row, fontSize)
  const highlighted = mark(18, 19)
  assert.ok(markUnderPoint(body, 20, (band.top + band.bot) / 2, [highlighted], fontSize))
  assert.equal(markUnderPoint(body, 20, band.top - 4, [highlighted], fontSize), null)
  assert.equal(markUnderPoint(body, 20, band.bot + 4, [highlighted], fontSize), null)
  assert.equal(markUnderPoint(body, 50, (band.top + band.bot) / 2, [highlighted], fontSize), null)
})

test('an underline hit includes the stroke and still ignores the gap above the line', () => {
  const row = line(0, [word('力', 0, 4)])
  const body = page([row])
  const stroke = row.baseline + 4.4
  const underlined = mark(4, 5, 'underline')
  assert.ok(markUnderPoint(body, 8, stroke, [underlined], fontSize))
  assert.equal(markUnderPoint(body, 8, 1, [underlined], fontSize), null)
})

test('localInProjectedBox reads a DOMMatrix the way the text layer writes it', () => {
  // Recorded from a projected CJK span: matrix3d(a1, b1, …, a4, b4, …) with translation in m41/m42.
  const m = { m11: 0.6272, m12: -0.0021018, m14: -0.0000014, m21: -0.0884758, m22: 0.511512, m24: -0.0001263, m41: 849.188, m42: 371.925, m44: 1 }
  const center = localInProjectedBox(m, 856.8700866699219, 382.64356994628906)
  assert.ok(center)
  assert.ok(center.y > 12 && center.y < 30, `glyph center landed at ${center.y}`)
  const leading = localInProjectedBox(m, 856.8700866699219, 371.887939453125 + 21.511260986328125 * 0.92)
  assert.ok(leading)
  assert.ok(leading.y > 34, `lower leading landed at ${leading.y}`)
})

test('localInProjectedBox inverts translation, scale, and perspective', () => {
  const translated = { m11: 1, m12: 0, m14: 0, m21: 0, m22: 1, m24: 0, m41: 100, m42: 50, m44: 1 }
  assert.deepEqual(localInProjectedBox(translated, 110, 70), { x: 10, y: 20 })
  const scaled = { m11: 2, m12: 0, m14: 0, m21: 0, m22: 4, m24: 0, m41: 0, m42: 0, m44: 1 }
  assert.deepEqual(localInProjectedBox(scaled, 20, 40), { x: 10, y: 10 })
  const lx = 10
  const ly = 20
  const w = 1 + 0.001 * lx
  const perspective = { m11: 1, m12: 0, m14: 0.001, m21: 0, m22: 1, m24: 0, m41: 0, m42: 0, m44: 1 }
  const back = localInProjectedBox(perspective, lx / w, ly / w)
  assert.ok(back)
  assert.ok(Math.abs(back.x - lx) < 1e-6)
  assert.ok(Math.abs(back.y - ly) < 1e-6)
})
