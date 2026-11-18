import assert from 'node:assert/strict'
import test from 'node:test'
import { readerWheelIntent } from './viewGestures.ts'

const viewport = { clientWidth: 1400, clientHeight: 900 }
const event = { deltaMode: 0, deltaX: 12, deltaY: 80, ctrlKey: false, metaKey: false }
test('Mac scrolling preserves both axes even for fast scroll bursts', () => {
  assert.deepEqual(readerWheelIntent(event, viewport, 'MacIntel'), { kind: 'pan', x: 12, y: 80 })
  assert.deepEqual(readerWheelIntent({ ...event, deltaY: 700 }, viewport, 'MacIntel'), { kind: 'pan', x: 12, y: 700 })
  assert.deepEqual(readerWheelIntent({ ...event, deltaMode: 1 }, viewport, 'MacIntel'), { kind: 'pan', x: 192, y: 1280 })
})
test('non-Mac wheels and explicit pinch/modifiers retain gentle bounded zoom', () => {
  for (const platform of ['Win32', 'MacIntel'] as const) {
    for (const modifier of ['ctrlKey', 'metaKey'] as const) {
      const result = readerWheelIntent({ ...event, deltaY: -10000, [modifier]: true }, viewport, platform)
      assert.equal(result.kind, 'zoom')
      if (result.kind === 'zoom') assert.ok(result.factor > 1 && result.factor < 1.13)
    }
  }
  assert.equal(readerWheelIntent(event, viewport, 'Win32').kind, 'zoom')
})
