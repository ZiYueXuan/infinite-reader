import assert from 'node:assert/strict'
import {test} from 'node:test'
import { resolveJudou, type Annotation } from './annotations.ts'
import type { Chapter } from './types.ts'
import {DEFAULT_LAYOUT, type Line, type Page, type Word} from './layout.ts'
import {judouAnchor, judouHit, markUnderPoint} from './pageRender.ts'

const cfg = DEFAULT_LAYOUT
const lineH = cfg.fontSize * 1.5 * 1.16
const baseline = lineH * 0.5 + cfg.fontSize * 0.32
const contentW = cfg.pageW - cfg.marginInner - cfg.marginOuter

function word(text: string, x: number, s: number): Word {
    return {
        text,
        x,
        w: cfg.fontSize,
        font: `${cfg.fontSize}px serif`,
        s,
        e: s + text.length,
        space: false,
        size: cfg.fontSize
    }
}

function line(y: number, words: Word[]): Line {
    return {y, h: lineH, baseline, words}
}

function page(lines: Line[]): Page {
    return {
        index: 2,
        chapter: 1,
        chapterTitle: '',
        lines,
        images: [],
        rules: [],
        start: 18,
        end: 19,
        chapterStart: false,
        label: '2'
    }
}

function judou(start: number): Annotation {
    return {
        id: 'j',
        bookId: 'b',
        locator: {chapter: 1, start, end: start + 1},
        quote: '',
        kind: 'judou',
        color: 'yellow',
        symbol: '/',
        createdAt: 1,
        updatedAt: 1
    }
}

test('the clause mark rides the baseline after its character, like 秋/十月', () => {
    const row = line(40, [word('秋', 100, 0)])
    const a = judouAnchor({x0: 100, x1: 122, line: row}, cfg)
    const size = cfg.fontSize, base = row.y + row.baseline
    assert.ok(Math.abs(a.y + a.h - (base + size * 0.03)) < 0.6, `the foot sits just below the baseline: ${a.y + a.h}`)
    assert.ok(a.y > base - size * 0.75 && a.y < base - size * 0.55, `the head stops inside the ink band: ${a.y}`)
    assert.ok(a.h > size * 0.6 && a.h < size * 0.72)
    assert.ok(a.x + a.lean / 2 > 122 - size * 0.12 && a.x + a.lean / 2 < 122 + size * 0.03, `the slash straddles the cell edge: ${a.x + a.lean / 2}`)
    assert.ok(a.x + a.lean <= 122 + size * 0.12, 'only the leaning top reaches into the next cell')
})

test('a mark after a line-final character hangs at most 0.2em into the margin', () => {
    const row = line(0, [word('也', contentW - cfg.fontSize, 0)])
    const a = judouAnchor({x0: contentW - 8, x1: contentW + 30, line: row}, cfg)
    assert.ok(a.x + a.lean <= contentW + cfg.fontSize * 0.2 + 1e-6)
    assert.ok(a.x > 0)
})

test('a click on the painted slash opens the clause mark, the character body does not', () => {
    const row = line(100, [word('羽', 10, 18)])
    const body = page([row])
    const mark = judou(18)
    const rect = {x0: 10, x1: 10 + cfg.fontSize, line: row}
    const a = judouAnchor(rect, cfg)
    const sx = a.x + a.lean / 2, sy = a.y + a.h / 2
    assert.ok(judouHit(rect, cfg, sx, sy))
    assert.equal(markUnderPoint(body, sx, sy, [mark], cfg), mark)
    assert.equal(markUnderPoint(body, 10 + cfg.fontSize * 0.45, row.y + row.baseline - cfg.fontSize * 0.3, [mark], cfg), null)
    assert.equal(markUnderPoint(body, a.x - cfg.fontSize * 0.3, sy, [mark], cfg), null)
})

test('overlapping slashes win on the stroke and preserve ordinary mark hit order elsewhere', () => {
  const row = line(100, [word('羽', 10, 18)])
  const body = page([row]), mark = judou(18)
  const highlight: Annotation = { ...mark, id: 'highlight', kind: 'highlight' }
  const underline: Annotation = { ...mark, id: 'underline', kind: 'underline' }
  const a = judouAnchor({ x0: 10, x1: 10 + cfg.fontSize, line: row }, cfg)
  const y = a.y + a.h / 2
  for (const marks of [[highlight, underline, mark], [mark, highlight, underline], [underline, mark, highlight]]) {
    assert.equal(markUnderPoint(body, a.x + a.lean / 2, y, marks, cfg), mark)
    assert.equal(markUnderPoint(body, 10 + cfg.fontSize / 3, y, marks, cfg), marks.find(m => m.kind !== 'judou'))
  }
})

function chapterOf(...paragraphs: string[]): Chapter {
  let offset = 0
  const blocks = paragraphs.map(text => {
    const start = offset
    offset += text.length + 1
    return { start, text, kind: 'p' as const, runs: [{ text }] }
  })
  return { index: 1, title: '', href: '', blocks, textLength: offset - 1 }
}

const range = (start: number, end = start) => ({ chapter: 1, start, end })

test('selection anchors include the whole grapheme even when a DOM endpoint splits it', () => {
  for (const glyph of ['也', '𠮷', '葛󠄀', 'e\u0301', '👩‍👧']) {
    const chapter = chapterOf('甲' + glyph + '乙')
    for (let end = 2; end <= 1 + glyph.length; end++) {
      const target = resolveJudou(chapter, range(0, end), [])
      assert.deepEqual(target?.locator, range(1, 1 + glyph.length))
      assert.equal(target?.quote, glyph)
    }
  }
})

test('ranges skip trailing spaces and block separators without creating an invisible mark', () => {
  const chapter = chapterOf('甲  ', '乙', '   ', '丙')
  const second = chapter.blocks[1].start
  assert.equal(resolveJudou(chapter, range(0, second), [])?.quote, '甲')
  assert.equal(resolveJudou(chapter, range(1, second), []), null)
  assert.equal(resolveJudou(chapter, range(second + 1, chapter.blocks[3].start), []), null)
  assert.equal(resolveJudou(chapter, range(100), []), null)
})

test('a caret targets a neighbour in its own paragraph and honours existing marks on either side', () => {
  const chapter = chapterOf('前', '甲𠮷乙')
  const start = chapter.blocks[1].start
  const first = judou(start)
  const rare: Annotation = { ...judou(start + 1), locator: range(start + 1, start + 3) }
  assert.deepEqual(resolveJudou(chapter, range(start), [])?.locator, first.locator)
  assert.equal(resolveJudou(chapter, range(start), [first])?.existing, first)
  assert.equal(resolveJudou(chapter, range(start), [rare])?.existing, undefined)
  assert.equal(resolveJudou(chapter, range(start + 1), [rare])?.existing, rare)
  assert.equal(resolveJudou(chapter, range(start + 1), [first, rare])?.existing, first)
  assert.equal(resolveJudou(chapter, range(start + 3), [rare])?.existing, rare)
  assert.equal(resolveJudou(chapter, range(start, start + 1), [rare])?.quote, '甲')
  assert.equal(resolveJudou(chapter, range(0), [])?.quote, '前')
})
