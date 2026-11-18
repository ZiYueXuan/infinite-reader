import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INITIAL_IMAGE_VIEW, constrainImage, imageFit, zoomImage } from './imagePreviewGeometry.ts'

test('a portrait image fits after rotation without clipping or upscaling a small original', () => {
  const viewport = { width: 800, height: 500 }
  assert.equal(imageFit({ width: 1000, height: 2000 }, viewport, 0), 0.25)
  assert.equal(imageFit({ width: 1000, height: 2000 }, viewport, 90), 0.4)
  assert.equal(imageFit({ width: 100, height: 200 }, viewport, 270), 1)
})

test('zoom keeps the image point under the pointer stable away from the pan limits', () => {
  const image = { width: 1000, height: 1000 }, viewport = { width: 500, height: 500 }
  const before = { ...INITIAL_IMAGE_VIEW, zoom: 2, x: 20, y: -10 }
  const pivot = { x: 70, y: 40 }
  const after = zoomImage(before, 1.5, pivot, image, viewport)
  assert.equal((pivot.x - before.x) / before.zoom, (pivot.x - after.x) / after.zoom)
  assert.equal((pivot.y - before.y) / before.zoom, (pivot.y - after.y) / after.zoom)
})

test('pan limits follow rotated dimensions and reset when the image fits again', () => {
  const image = { width: 1000, height: 2000 }, viewport = { width: 800, height: 500 }
  const panned = constrainImage({ zoom: 2, rotation: 90, x: 999, y: -999 }, image, viewport)
  assert.deepEqual(panned, { zoom: 2, rotation: 90, x: 400, y: -150 })
  assert.deepEqual(constrainImage({ ...panned, zoom: 1 }, image, viewport), { zoom: 1, rotation: 90, x: 0, y: 0 })
  assert.equal(constrainImage({ ...panned, zoom: 50 }, image, viewport).zoom, 8)
})
