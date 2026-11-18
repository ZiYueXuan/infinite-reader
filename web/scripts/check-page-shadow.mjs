// Run in the existing in-app browser on the local Vite site:
//   const { checkPageShadow } = await import('/scripts/check-page-shadow.mjs')
//   checkPageShadow(window.__reader)
// Exercise the actual GPU shader: a sheet underneath must not shadow the receiver,
// while a sheet above it must still cast a continuous, soft shadow.
import * as THREE from 'three'
import { createPaperMaterial, shadowRig, SH_COLS, SH_ROWS } from '../src/engine/paperMaterial.ts'

export function checkPageShadow(reader) {
  const renderer = reader.renderer
  const target = new THREE.WebGLRenderTarget(512, 128)
  const previousTarget = renderer.getRenderTarget()
  const texture = shadowRig.uShTex.value
  const previousData = texture.image.data.slice()
  const previousCount = shadowRig.uShN.value
  const { material, uniforms } = createPaperMaterial()
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 2))
  const camera = new THREE.OrthographicCamera(-3.2, 3.2, 1.6, -1.6, 0.1, 100)
  const geo = new THREE.PlaneGeometry(6.4, 3.2, 39, 25)
  geo.setAttribute('aCurv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1))
  const mesh = new THREE.Mesh(geo, material)
  scene.add(mesh)
  const baseline = new Uint8Array(512 * 128 * 4)
  const shaded = new Uint8Array(baseline.length)
  const results = []

  function render(receive, pixels) {
    uniforms.uShRecv.value = receive
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 0, 0, 512, 128, pixels)
  }

  try {
    for (const curved of [false, true]) for (const tilt of [0, 0.8]) {
      const profile = (x) => curved ? 0.8 * (1 - Math.exp(-(x + 3.2) / 0.95)) : 0
      const pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) pos.setZ(i, profile(pos.getX(i)))
      pos.needsUpdate = true
      geo.computeVertexNormals()
      camera.position.set(0, -20 * Math.sin(tilt), 20 * Math.cos(tilt))
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      for (const gap of [-0.005, -0.012, -0.05, 0.06, 0.25]) for (const reverse of [false, true]) {
        const data = texture.image.data
        for (let row = 0; row < SH_ROWS; row++) for (let i = 0; i < SH_COLS; i++) {
          const x = (reverse ? 1 - i / (SH_COLS - 1) : i / (SH_COLS - 1)) * 6.4 - 3.2
          const at = (row * SH_COLS + i) * 4
          data[at] = x
          data[at + 1] = profile(x) + gap
          data[at + 2] = -1.6 + row / (SH_ROWS - 1) * 3.2
          data[at + 3] = 1
        }
        texture.needsUpdate = true
        shadowRig.uShN.value = 1
        render(0, baseline)
        render(1, shaded)
        let maxShadow = 0, maxStep = 0, previous = null
        // The central scanline stays inside the receiver at both camera angles.
        // Sampling the outer half includes the repeated stripes in the reported failure.
        for (let x = 260; x < 460; x++) {
          const at = (64 * 512 + x) * 4
          const lit = baseline[at] + baseline[at + 1] + baseline[at + 2]
          const dark = shaded[at] + shaded[at + 1] + shaded[at + 2]
          const amount = lit > 0 ? 1 - dark / lit : 0
          maxShadow = Math.max(maxShadow, amount)
          if (previous !== null) maxStep = Math.max(maxStep, Math.abs(amount - previous))
          previous = amount
        }
        const ok = gap < 0 ? maxShadow < 0.004 : maxShadow > 0.12 && maxShadow < 0.31 && maxStep < 0.015
        results.push({ curved, tilt, gap, reverse, maxShadow, maxStep, ok })
      }
    }
  } finally {
    texture.image.data.set(previousData)
    texture.needsUpdate = true
    shadowRig.uShN.value = previousCount
    renderer.setRenderTarget(previousTarget)
    geo.dispose()
    material.dispose()
    target.dispose()
    reader.renderNow()
  }
  return { checks: results.length, failures: results.filter((r) => !r.ok), results }
}
