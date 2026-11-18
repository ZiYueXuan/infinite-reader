import assert from 'node:assert/strict'
import test from 'node:test'
import { GutterFold } from './gutterFold.ts'

test('the bound edge stays on the spine plane throughout opening, at every paper height', () => {
  for (const thickness of [0.14, 0.35, 1.15]) {
    const hinge = 0.11 + thickness / 2
    for (let step = 0; step <= 180; step++) {
      const theta = step * Math.PI / 180
      const fold = new GutterFold(theta, hinge)
      for (const fraction of [0, 0.01, 0.25, 0.5, 0.99, 1]) {
        const z = 0.11 + thickness * fraction
        const p = fold.point(0, z)
        const worldX = p.x * Math.cos(theta) + (p.z - hinge) * Math.sin(theta)
        const worldZ = -p.x * Math.sin(theta) + (p.z - hinge) * Math.cos(theta) + hinge
        assert.ok(Math.abs(worldX) < 1e-12)
        assert.ok(Math.abs(worldZ - (hinge + (z - hinge) * Math.cos(theta))) < 1e-12)
      }
    }
  }
})

test('text beyond the binding margin and fully open/closed geometry stay unchanged', () => {
  for (const theta of [0, 0.1, Math.PI / 2, Math.PI - 0.1, Math.PI]) {
    const fold = new GutterFold(theta, 0.685)
    for (const x of [-0.8, -1.2, -6.4]) assert.deepEqual(fold.point(x, 0.2), { x, z: 0.2 })
    if (theta === 0 || theta === Math.PI) {
      for (const x of [0, -0.1, -0.4]) assert.deepEqual(fold.point(x, 0.2), { x, z: 0.2 })
    }
  }
})
