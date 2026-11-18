import assert from 'node:assert/strict'
import test from 'node:test'
import { DESK_IDS, deskIdOf, deskSurface, loadPrefs, savePrefs } from './settings.ts'

test('desk surfaces preserve saved IDs and fall back to walnut', () => {
  assert.deepEqual(DESK_IDS, ['walnut', 'ash', 'ink', 'baize', 'stone'])
  assert.equal(deskIdOf(undefined), 'walnut')
  assert.equal(deskIdOf('oak'), 'walnut')
  assert.equal(deskIdOf('ink'), 'ink')
  for (const id of DESK_IDS) {
    assert.equal(deskIdOf(id), id)
    assert.equal(deskSurface(id).id, id)
  }
})

test('legacy preferences gain ivory endpapers and appearance choices persist independently', (t) => {
  const key = 'infinite-reader:prefs:v1'
  const values = new Map([[key, JSON.stringify({ desk: 'ash', tilt: 0.72, turnHintSeen: true })]])
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
    },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })

  assert.equal(loadPrefs().quoteFont, 'wenkai')
  assert.equal(loadPrefs().endpaper, 'ivory')
  savePrefs({ endpaper: 'slate' })
  assert.deepEqual(loadPrefs(), { readerFont: 'wenkai', quoteFont: 'wenkai', desk: 'ash', tilt: 0.72, turnHintSeen: true, tiltHintSeen: false, endpaper: 'slate' })
  savePrefs({ desk: 'stone' })
  assert.equal(loadPrefs().endpaper, 'slate')
  values.set(key, JSON.stringify({ ...loadPrefs(), endpaper: 'unknown' }))
  assert.equal(loadPrefs().endpaper, 'ivory')
  assert.equal(loadPrefs().desk, 'stone')
  savePrefs({ readerFont: 'wenkai' })
  assert.equal(loadPrefs().readerFont, 'wenkai')
  assert.equal(loadPrefs().desk, 'stone')
  savePrefs({ quoteFont: 'inherit' })
  savePrefs({ readerFont: 'noto-serif' })
  assert.equal(loadPrefs().quoteFont, 'inherit')
  values.set(key, JSON.stringify({ ...loadPrefs(), quoteFont: 'invalid', readerFont: 'missing-font' }))
  assert.equal(loadPrefs().quoteFont, 'wenkai')
  assert.equal(loadPrefs().readerFont, 'wenkai')
})
