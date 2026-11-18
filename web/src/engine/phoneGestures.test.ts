import assert from 'node:assert/strict'
import test from 'node:test'
import { PhoneGestures } from './phoneGestures.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: { getSelection: () => ({ isCollapsed: true }) } })
const event = (type: string, x: number, y: number, time: number, id = 1) => ({ type, clientX: x, clientY: y, timeStamp: time, pointerId: id, button: 0, cancelable: true, preventDefault() {} } as PointerEvent)
function setup() {
  const log: unknown[][] = []
  const gestures = new PhoneGestures({ begin: (...args) => { log.push(['begin', ...args]); return true },
    move: (...args) => log.push(['move', ...args]), end: (...args) => log.push(['end', ...args]), tap: (...args) => log.push(['tap', ...args]) })
  return { gestures, log }
}

test('short taps open controls; long holds and vertical movement never become taps', () => {
  for (const variant of ['tap', 'long', 'vertical']) {
    const { gestures, log } = setup()
    gestures.down(event('pointerdown', 190, 300, 0))
    if (variant === 'vertical') gestures.move(event('pointermove', 191, 330, 50))
    gestures.up(event('pointerup', 190, 300, variant === 'long' ? 650 : 100))
    assert.deepEqual(log, variant === 'tap' ? [['tap', 190, 300]] : [])
  }
})

test('horizontal touch intent chooses exactly one direction and cancellation returns the held leaf', () => {
  for (const dir of [1, -1]) {
    const { gestures, log } = setup()
    gestures.down(event('pointerdown', 200, 300, 0))
    gestures.move(event('pointermove', 200 - dir * 30, 302, 50))
    assert.equal(log[0][1], dir)
    assert.equal(gestures.turning, true)
    gestures.up(event('pointercancel', 200 - dir * 30, 302, 80))
    assert.equal(log.at(-1)?.[2], true)
    assert.equal(gestures.turning, false)
  }
})

test('a second finger cancels the turn and never triggers an accidental tap', () => {
  const { gestures, log } = setup()
  gestures.down(event('pointerdown', 300, 300, 0))
  gestures.move(event('pointermove', 260, 300, 30))
  gestures.down(event('pointerdown', 180, 300, 40, 2))
  gestures.up(event('pointerup', 180, 300, 60, 2))
  gestures.up(event('pointerup', 260, 300, 70))
  assert.equal(log.at(-1)?.[0], 'end')
  assert.equal(log.at(-1)?.[2], true)
  assert.ok(!log.some(row => row[0] === 'tap'))
})

test('long press previews selection and finishes exactly once on release, never as a turn or tap', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const drag of [false, true]) {
    const log: string[] = []
    const gestures = new PhoneGestures({ begin: () => { log.push('turn'); return true }, move: () => log.push('move'),
      end: () => log.push('end'), tap: () => log.push('tap'), longPress: () => { log.push('select'); return true },
      extendSelection: () => log.push('extend'), endSelection: cancel => log.push(cancel ? 'cancel' : 'show-toolbar') })
    gestures.down(event('pointerdown', 100, 100, 0))
    t.mock.timers.tick(450)
    if (drag) gestures.move(event('pointermove', 220, 160, 600))
    const preview = drag ? ['select', 'extend'] : ['select']
    assert.deepEqual(log, preview)
    gestures.up(event('pointerup', 220, 160, 700))
    gestures.up(event('pointerup', 220, 160, 710))
    gestures.move(event('pointermove', 260, 200, 800))
    assert.deepEqual(log, [...preview, 'show-toolbar'])
    assert.equal(gestures.turning, false)
  }
})

test('cancelled touches, a second finger and interruptions discard selection without opening tools', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const reason of ['pointercancel', 'second-finger', 'interruption']) {
    const log: string[] = []
    const gestures = new PhoneGestures({ begin: () => { log.push('turn'); return true }, move: () => {}, end: () => {},
      tap: () => log.push('tap'), longPress: () => true, endSelection: cancel => log.push(cancel ? 'cancel' : 'show-toolbar') })
    gestures.down(event('pointerdown', 100, 100, 0))
    t.mock.timers.tick(450)
    if (reason === 'pointercancel') gestures.up(event('pointercancel', 100, 100, 600))
    else if (reason === 'second-finger') gestures.down(event('pointerdown', 220, 160, 600, 2))
    else gestures.cancel(true)
    gestures.up(event('pointerup', 220, 160, 700, 2))
    gestures.up(event('pointerup', 100, 100, 710))
    assert.deepEqual(log, ['cancel'], reason)
    gestures.down(event('pointerdown', 100, 100, 800))
    gestures.up(event('pointerup', 100, 100, 900))
    assert.deepEqual(log, ['cancel', 'tap'], 'a cancelled selection does not block the next gesture')
  }
})
