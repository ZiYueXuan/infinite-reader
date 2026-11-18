import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { alignedNoteRotation } from './noteAlignment.ts'

test('both inner note edges remain parallel to the book across camera views and placements', () => {
  let cases = 0
  for (const tilt of [0, 0.16, 0.44, 0.9, 1.08]) for (const distance of [20, 35, 60]) {
    for (const pan of [-4, 0, 4]) for (const side of [-1, 1] as const) for (const y of [-3, 0, 3]) {
      const camera = new PerspectiveCamera(24, 16 / 9, 0.1, 200)
      camera.position.set(pan, 1 - distance * Math.sin(tilt), distance * Math.cos(tilt))
      camera.up.set(0, 1, 0)
      camera.lookAt(pan, 1, 0)
      camera.updateMatrixWorld()
      const pixel = (v: Vector3) => {
        v.project(camera)
        return { x: (v.x + 1) * 720, y: (1 - v.y) * 450 }
      }
      const project = (x: number, y: number, z: number) => pixel(new Vector3(x, y, z))
      const note = { x: side * 8.4, y, z: 0.035, size: 2.5, curlRise: 0.084 }
      const bookTop = project(side * 6.4, 4.6, side > 0 ? 1.5 : 0.2)
      const bookBottom = project(side * 6.4, -4.6, side > 0 ? 1.5 : 0.2)
      const rotation = alignedNoteRotation(note, side, [bookTop, bookBottom], project)
      // Check the final geometry through an independent rotation matrix and perspective projection.
      const matrix = new Matrix4().makeRotationZ(rotation).setPosition(note.x, note.y, note.z)
      const top = pixel(new Vector3(-side * 1.25, 1.25, 0).applyMatrix4(matrix))
      const bottom = pixel(new Vector3(-side * 1.25, -1.25, note.curlRise).applyMatrix4(matrix))
      const nx = bottom.x - top.x, ny = bottom.y - top.y
      const bx = bookBottom.x - bookTop.x, by = bookBottom.y - bookTop.y
      const error = Math.abs(Math.atan2(nx * by - ny * bx, nx * bx + ny * by))
      assert.ok(Number.isFinite(rotation) && error < 1e-6, JSON.stringify({ tilt, distance, pan, side, y, rotation, error }))
      cases++
    }
  }
  assert.equal(cases, 270)
})

test('a degenerate book edge leaves a finite neutral angle', () => {
  assert.equal(alignedNoteRotation(
    { x: 8, y: 0, z: 0.03, size: 2.5, curlRise: 0.084 },
    1,
    [{ x: 10, y: 10 }, { x: 10, y: 10 }],
    (x, y) => ({ x, y }),
  ), 0)
})
