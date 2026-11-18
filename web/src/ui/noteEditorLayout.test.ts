import assert from 'node:assert/strict'
import test from 'node:test'
import { noteEditorLayout } from './noteEditorLayout.ts'

test('quote editing stays at its original text position and leaves room for controls', () => {
  const p = noteEditorLayout({ left: 600, top: 260, width: 360, height: 60 }, { left: 0, top: 0, width: 1440, height: 900 })
  assert.equal(p.x, 600)
  assert.equal(p.y, 260)
  assert.equal(p.width, 360)
  assert.ok(p.height >= 210)
})

test('quote editor remains reachable with narrow screens and the software keyboard open', () => {
  for (const viewport of [
    { left: 0, top: 0, width: 1440, height: 900 },
    { left: 0, top: 0, width: 320, height: 568 },
    { left: 0, top: 240, width: 390, height: 260 },
    { left: 20, top: 80, width: 240, height: 180 },
  ]) for (const x of [-200, 0, 150, 1400]) for (const y of [-100, 0, 350, 850]) {
    const p = noteEditorLayout({ left: x, top: y, width: 650, height: 900 }, viewport)
    assert.ok(p.x >= viewport.left + 12)
    assert.ok(p.y >= viewport.top + 12)
    assert.ok(p.x + p.width <= viewport.left + viewport.width - 12)
    assert.ok(p.y + p.height <= viewport.top + viewport.height - 12)
  }
})

test('edge correction preserves the other axis', () => {
  const p = noteEditorLayout({ left: 1330, top: 300, width: 300, height: 100 }, { left: 0, top: 0, width: 1440, height: 900 })
  assert.equal(p.y, 300)
  assert.equal(p.x + p.width, 1428)
})

test('manual size can exceed default limits while staying inside a changing viewport', () => {
  const note = { left: 700, top: 500, width: 320, height: 80 }
  const preferred = { width: 800, height: 650 }
  const large = noteEditorLayout(note, { left: 0, top: 0, width: 1440, height: 900 }, preferred)
  assert.equal(large.width, 800)
  assert.equal(large.height, 650)
  for (const viewport of [{ left: 0, top: 0, width: 390, height: 720 }, { left: 0, top: 180, width: 390, height: 280 }]) {
    const small = noteEditorLayout(note, viewport, preferred)
    assert.ok(small.x >= viewport.left + 12 && small.y >= viewport.top + 12)
    assert.ok(small.x + small.width <= viewport.left + viewport.width - 12)
    assert.ok(small.y + small.height <= viewport.top + viewport.height - 12)
  }
  assert.deepEqual(preferred, { width: 800, height: 650 })
})
