import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson'

const water = JSON.parse(readFileSync(new URL('../../public/atlas/water.json', import.meta.url), 'utf8')) as FeatureCollection<Polygon | MultiPolygon>

function inRing([x, y]: Position, ring: Position[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j]
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside
  }
  return inside
}

function isWater(point: Position) {
  return water.features.some(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    return polygons.some(([outer, ...holes]) => inRing(point, outer) && !holes.some((ring) => inRing(point, ring)))
  })
}

test('coastline mask preserves real islands and land below sea level', () => {
  for (const [name, point] of [
    ['Rome', [12.48, 41.90]], ['Corsica', [9.1, 42.1]], ['Sardinia', [9, 40]],
    ['Flevoland polder below sea level', [5.54, 52.45]], ['Death Valley', [-116.82, 36.24]],
  ] as const) assert.equal(isWater([...point]), false, `${name} must remain land`)
})

test('coastal water, lakes, and both sides of the date line remain water', () => {
  for (const [name, point] of [
    ['Adriatic', [15, 43]], ['Po delta offshore', [12.65, 44.85]], ['Tyrrhenian', [10, 40.5]],
    ['Lake Michigan', [-87, 44]], ['Caspian Sea', [51, 42]],
    ['West Pacific', [179.9, 0]], ['East Pacific', [-179.9, 0]],
  ] as const) assert.equal(isWater([...point]), true, `${name} must remain water`)
})
