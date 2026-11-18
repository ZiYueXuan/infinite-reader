import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { expression, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { Map as GlobeMap } from 'maplibre-gl'
import { atlasStyle } from './mapStyle.ts'
import { waterName, watchWaterDetail, WATER_DETAIL_SOURCE } from './hydrology.ts'

test('both language styles validate, contain water-only detail and use local fonts', () => {
  for (const locale of ['zh-CN', 'en']) {
    const s = atlasStyle('https://example.test', locale)
    assert.deepEqual(validateStyleMin(s), [])
    assert.equal(s.glyphs, undefined)
    assert.deepEqual(new Set(s.layers.filter(l => 'source' in l && l.source === WATER_DETAIL_SOURCE).map(l => 'source-layer' in l && l['source-layer'])), new Set(['water', 'waterway', 'water_name']))
    assert.ok(s.layers.filter(l => 'source' in l && l.source === WATER_DETAIL_SOURCE).every(l => l.minzoom! >= 8))
  }
})

test('river names use source Chinese translations and fall back past missing/empty fields', () => {
  for (const [zh, detailed, properties, expected] of [
    [true, true, { 'name:zh-Hans': '黄浦江', name: 'Huangpu' }, '黄浦江'],
    [true, true, { 'name:zh-Hans': '', 'name:zh': '泰晤士河', name: 'Thames' }, '泰晤士河'],
    [true, false, { name_zh: null, name: 'Unnamed translation' }, 'Unnamed translation'],
    [false, true, { 'name:en': '', name_en: 'Thames', name: '泰晤士河' }, 'Thames'],
  ] as const) {
    const parsed = expression.createExpression(waterName(zh, detailed), 'layers[0].layout.text-field')
    assert.equal(parsed.result, 'success')
    if (parsed.result === 'success') assert.equal(parsed.value.evaluate({ zoom: 10 }, { type: 2, properties }), expected)
  }
})

test('bundled global fallback includes Chinese and overseas named river lines', () => {
  const data = JSON.parse(readFileSync(new URL('../../public/atlas/rivers.json', import.meta.url), 'utf8'))
  assert.equal(data.features.length, 4224)
  for (const name of ['黄河', '长江', '汾河', '泰晤士河']) {
    assert.ok(data.features.some((f: { properties: { name_zh?: string } }) => f.properties.name_zh === name), name)
  }
  assert.ok(data.features.every((f: { geometry: { type: string } }) => ['LineString', 'MultiLineString'].includes(f.geometry.type)))
})

function fakeMap() {
  const listeners = new Map<string, Set<(event: object) => void>>()
  const state = { zoom: 10, loaded: false, detail: false }
  const map = {
    getSource: () => ({}), getZoom: () => state.zoom, isSourceLoaded: () => state.loaded,
    setGlobalStateProperty: (_: string, value: boolean) => { state.detail = value },
    on: (name: string, cb: (event: object) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(cb) },
    off: (name: string, cb: (event: object) => void) => listeners.get(name)?.delete(cb),
  }
  return { map: map as unknown as GlobeMap, state, listeners, emit: (name: string) => listeners.get(name)?.forEach(cb => cb({ sourceId: WATER_DETAIL_SOURCE })) }
}

test('detail failure before the first load never hides fallback; handlers clean up', () => {
  const f = fakeMap(), notices: boolean[] = []
  const stop = watchWaterDetail(f.map, value => notices.push(value))
  f.emit('error'); f.state.loaded = true; f.emit('sourcedata')
  assert.equal(f.state.detail, false)
  assert.equal(notices.at(-1), true)
  stop(); assert.ok([...f.listeners.values()].every(set => set.size === 0))
})

test('slow detail keeps fallback, recovers on load, and restores fallback after a later failed tile', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fakeMap(), notices: boolean[] = []
  const stop = watchWaterDetail(f.map, value => notices.push(value))
  t.mock.timers.tick(15001)
  assert.equal(f.state.detail, false); assert.equal(notices.at(-1), true)
  f.state.loaded = true; f.emit('sourcedata')
  assert.equal(f.state.detail, true); assert.equal(notices.at(-1), false)
  f.emit('error'); assert.equal(f.state.detail, false)
  stop()
})
