import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GeoJSONVT, type GeoJSONVTFeature } from '@maplibre/geojson-vt'
import { classifyRings } from '@maplibre/maplibre-gl-style-spec'
import earcut, { flatten } from 'earcut'
import type { FeatureCollection, Polygon } from 'geojson'
import type { GeoJSONSourceSpecification } from 'maplibre-gl'
import { atlasStyle } from './mapStyle.ts'

const water = JSON.parse(readFileSync(new URL('../../public/atlas/water.json', import.meta.url), 'utf8')) as FeatureCollection<Polygon>
const source = atlasStyle('https://example.test').sources.water as GeoJSONSourceSpecification
// Exercise MapLibre's actual tiler, ring classifier, and triangulator. Valid
// GeoJSON alone did not catch water triangles spanning the interior of India.
const extent = 8192
const index = new GeoJSONVT(water, {
  maxZoom: source.maxzoom, extent, updateable: true,
  buffer: (source.buffer ?? 128) * extent / 512,
  tolerance: (source.tolerance ?? 0.375) * extent / 512,
})
type Mesh = { vertices: number[]; triangles: number[] }
const tiles = new Map<string, Mesh[]>()

function meshes(z: number, x: number, y: number): Mesh[] {
  const key = `${z}/${x}/${y}`
  if (!tiles.has(key)) {
    const result: Mesh[] = []
    for (const feature of (index.getTile(z, x, y)?.features ?? []) as GeoJSONVTFeature[]) {
      if (feature.type !== 3) continue
      const rings = feature.geometry.map((ring) => ring.map(([x, y]) => ({ x, y })))
      for (const polygon of classifyRings(rings, 500)) {
        const { vertices, holes } = flatten(polygon.map((ring) => ring.map(({ x, y }) => [x, y])))
        result.push({ vertices, triangles: earcut(vertices, holes) })
      }
    }
    tiles.set(key, result)
  }
  return tiles.get(key)!
}

function renderedWaterAt(lng: number, lat: number, zoom: number): boolean {
  const worldX = (lng + 180) / 360 * 2 ** zoom
  const worldY = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** zoom
  const tx = Math.floor(worldX), ty = Math.floor(worldY)
  const x = (worldX - tx) * extent, y = (worldY - ty) * extent
  for (const { vertices, triangles } of meshes(zoom, tx, ty)) {
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] * 2, b = triangles[i + 1] * 2, c = triangles[i + 2] * 2
      const cross = (u: number, v: number) => (vertices[v] - vertices[u]) * (y - vertices[u + 1]) - (vertices[v + 1] - vertices[u + 1]) * (x - vertices[u])
      const area = (vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) - (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a])
      if (!area) continue
      const signs = [cross(a, b), cross(b, c), cross(c, a)]
      if (signs.every((v) => v >= 0) || signs.every((v) => v <= 0)) return true
    }
  }
  return false
}

test('water triangles never bridge the Indian mainland at overview tile levels', () => {
  for (const zoom of [3, 4, 5, 6, 7]) {
    for (const lng of [74, 78, 82, 86]) {
      assert.equal(renderedWaterAt(lng, 23.05, zoom), false, `India ${lng},23.05 at z${zoom}`)
    }
  }
})

test('rendered ocean remains continuous around India and across partition boundaries', () => {
  for (const zoom of [3, 4, 5, 6]) {
    for (const [lng, lat] of [[65, 15], [70, 15], [70.0001, 15], [90, 15], [90.0001, 15], [80, 0]]) {
      assert.equal(renderedWaterAt(lng, lat, zoom), true, `Ocean ${lng},${lat} at z${zoom}`)
    }
  }
})

test('rendered land, islands, and large lakes survive water triangulation', () => {
  for (const [lng, lat, expected] of [
    [-42, 73, false], [12.48, 41.9, false], [9.1, 42.1, false], [5.54, 52.45, false],
    [-87, 44, true], [51, 42, true], [15, 43, true], [179.9, 0, true], [-179.9, 0, true],
  ] as const) {
    assert.equal(renderedWaterAt(lng, lat, 6), expected, `${lng},${lat}`)
  }
})
