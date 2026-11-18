import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { CaseBinding } from './binding.ts'

const board = 0.11

test('spine stays attached to both boards and above the desk throughout opening', () => {
  for (const block of [0.14, 0.35, 0.85, 1.15]) {
    const binding = new CaseBinding(9.2, 0.15, board, block, new THREE.Color('#645449'))
    try {
      const shell = binding.group.getObjectByName('case-spine') as THREE.Mesh
      const pos = shell.geometry.attributes.position
      const r = board + block / 2
      for (let step = 0; step <= 24; step++) for (const fraction of [0, 0.05, 0.5, 0.95, 1]) {
        const theta = step / 24 * Math.PI
        binding.update(theta, board + block * (1 - fraction), board + block * fraction)
        assert.ok(Math.abs(pos.getX(0) - binding.joint) < 1e-6)
        assert.ok(Math.abs(pos.getZ(0)) < 1e-6)
        const end = pos.count - 8
        const x = -binding.joint * Math.cos(theta) - r * Math.sin(theta)
        const z = r + binding.joint * Math.sin(theta) - r * Math.cos(theta)
        assert.ok(Math.abs(pos.getX(end) - x) < 1e-6)
        assert.ok(Math.abs(pos.getZ(end) - z) < 1e-6)
        for (const child of binding.group.children as THREE.Mesh[]) {
          const p = child.geometry.attributes.position, n = child.geometry.attributes.normal
          for (let i = 0; i < p.count; i++) {
            assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)))
            assert.ok(p.getZ(i) >= -1e-6, `below desk: ${block}, ${theta}, ${fraction}`)
            assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-4)
          }
        }
      }
    } finally { binding.dispose() }
  }
})

test('the fully open case retains width, relief, and reuses its buffers while pages turn', () => {
  const binding = new CaseBinding(9.2, 0.15, board, 1.15, new THREE.Color('#645449'))
  try {
    const meshes = binding.group.children as THREE.Mesh[]
    const arrays = meshes.map((m) => m.geometry.attributes.position.array)
    const materials = meshes.map((m) => m.material)
    for (const fraction of [0, 0.02, 0.5, 0.98, 1]) {
      binding.update(0, board + 1.15 * (1 - fraction) * 0.4, board + 1.15 * fraction * 0.4)
      meshes.forEach((mesh, i) => {
        assert.equal(mesh.geometry.attributes.position.array, arrays[i])
        assert.equal(mesh.material, materials[i])
        assert.equal(mesh.visible, true)
      })
      const p = meshes[0].geometry.attributes.position
      assert.ok(p.getX(0) - p.getX(p.count - 8) > 0.5)
      assert.ok(p.getZ(24 * 8) > 0.04)
    }
  } finally { binding.dispose() }
})

test('head and tail bands stay outside the page edges and below the thinner stack', () => {
  const binding = new CaseBinding(9.2, 0.15, board, 1.15, new THREE.Color('#645449'))
  try {
    for (const [right, left] of [[0.64, 0.17], [0.17, 0.64], [0.36, 0.36]]) {
      binding.update(0, right, left)
      const mesh = binding.group.getObjectByName('head-band') as THREE.Mesh
      const p = mesh.geometry.attributes.position
      for (let i = 0; i < p.count; i++) {
        assert.ok(p.getY(i) > 9.2 / 2)
        assert.ok(p.getZ(i) < Math.min(right, left))
      }
    }
  } finally { binding.dispose() }
})
