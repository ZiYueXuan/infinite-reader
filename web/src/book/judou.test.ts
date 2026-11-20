import assert from 'node:assert/strict'
import {test} from 'node:test'
import {judouCharOf, judouToggleRange, type Annotation} from './annotations.ts'
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

test('a selection marks its last character, a caret marks the one before it', () => {
    assert.deepEqual(judouCharOf({chapter: 3, start: 40, end: 47}), {chapter: 3, start: 46, end: 47})
    assert.deepEqual(judouCharOf({chapter: 0, start: 0, end: 1}), {chapter: 0, start: 0, end: 1})
    assert.deepEqual(judouCharOf({chapter: 2, start: 9, end: 9}), {chapter: 2, start: 9, end: 10})
})

test('a caret removes a neighbouring clause mark before adding a new one', () => {
    const marks = [judou(10)]
    // The caret sits before the marked character: remove it instead of marking the previous one.
    assert.deepEqual(judouToggleRange({chapter: 1, start: 9, end: 10}, marks, true), {chapter: 1, start: 10, end: 11})
    // The caret sits after it: the same mark goes.
    assert.deepEqual(judouToggleRange({chapter: 1, start: 10, end: 11}, marks, true), {chapter: 1, start: 10, end: 11})
    // A selection still marks its own last character, even when the next one is marked.
    assert.deepEqual(judouToggleRange({chapter: 1, start: 7, end: 10}, marks, false), {chapter: 1, start: 9, end: 10})
    // Nothing marked nearby: the caret adds after the character it follows.
    assert.deepEqual(judouToggleRange({chapter: 1, start: 3, end: 4}, [], true), {chapter: 1, start: 3, end: 4})
    // A caret at the chapter start can still remove the mark on the first character, but never
    // mistakes the second character for the one before it.
    assert.deepEqual(judouToggleRange({chapter: 1, start: 0, end: 0}, [judou(0)], true), {chapter: 1, start: 0, end: 1})
    assert.deepEqual(judouToggleRange({chapter: 1, start: 0, end: 0}, [judou(1)], true), {chapter: 1, start: 0, end: 1})
})
