import * as THREE from 'three'
import { BookModel } from '../src/engine/book.ts'

/** Detached models exercise real page meshes without changing the reader's saved progress. */
export async function checkPageIdentity(cover, onProgress = () => {}) {
  let checks = 0, cases = 0
  const failures = []
  const assert = (ok, message) => { checks++; if (!ok) failures.push(message) }
  const tick = (book, frames = 270) => { for (let i = 0; i < frames; i++) book.update(1 / 60) }
  for (const count of [8, 250, 1600]) {
    const textures = new Map()
    const texture = (page) => {
      if (!textures.has(page)) { const t = new THREE.Texture(); t.userData.page = page; textures.set(page, t) }
      return textures.get(page)
    }
    const book = new BookModel({ leafCount: count, turned: 0, open: true, cover, getTexture: texture })
    const check = (label) => {
      assert(!book.busy, `${label}: did not settle`)
      const turned = book.settledTurned
      assert([...book.st].every((s, k) => s === (k < turned ? 1 : 0)), `${label}: page order differs from spread ${turned}`)
      for (const side of [-1, 1]) {
        const expected = side === -1 ? turned - 1 : turned
        const surface = book.pageSurface(side)
        assert(expected < 0 || expected >= count ? !surface : surface?.key === expected, `${label}: wrong ${side} page`)
      }
      for (const [key, leaf] of book.used) {
        assert(leaf.uniforms.uFront.value === texture(2 * key) && leaf.uniforms.uBack.value === texture(2 * key + 1), `${label}: swapped texture on leaf ${key}`)
      }
      cases++
    }
    try {
      for (const side of [1, -1]) for (const gap of [5, 15, 30, 60, 120]) {
        book.jumpTo(side === 1 ? 0 : count); book.update(0)
        book.beginDrag(side, .96, .5); book.endDrag(0, false); tick(book, gap)
        if (book.beginDrag(side, .96, .5)) book.endDrag(0, false)
        tick(book, gap)
        // Before the fix, gap=30 allowed sheets 0 and 1 to cross, leaving [right,left,right,...].
        const inFlight = book.busy
        const reverse = book.beginDrag(-side, .96, .5)
        assert(!inFlight || !reverse, `${count}/${side}/${gap}: reversed through flying sheets`)
        if (reverse) book.endDrag(0, false)
        tick(book); check(`${count}/${side}/${gap}`)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      for (const side of [1, -1]) {
        book.jumpTo(side === 1 ? 0 : count); book.update(0)
        book.beginDrag(side, .96, .5)
        assert(book.turn(side, 2) === 0, 'keyboard turn passed a held sheet')
        book.endDrag(0, true) // An unmoved drag returns to its original stack.
        assert(!book.beginDrag(side, .96, .5), 'new drag passed a returning sheet')
        assert(book.turn(side) === 0, 'keyboard turn passed a returning sheet')
        tick(book); check(`${count}/${side}/cancel`)
      }
      book.jumpTo(0); book.update(0)
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const side of [1, -1]) {
          book.setPeel(.12, side, .2 + cycle * .3); tick(book, 40)
          const page = book.pageSurface(side)
          const front = page.uniforms.uFront.value, back = page.uniforms.uBack.value
          assert(book.beginDrag(side, .96, .5), 'settled edge did not respond')
          assert(page.uniforms.uFront.value === front && page.uniforms.uBack.value === back, 'press changed page texture')
          // A stationary press must keep the same visible sheet, including before mouse-up.
          for (let frame = 0; frame < 30; frame++) {
            book.update(1 / 60); book.group.updateMatrixWorld(true)
            for (const leaf of book.used.values()) leaf.geo.computeBoundingSphere()
            for (const x of [1.5, 3, 5]) {
              const ray = new THREE.Raycaster(new THREE.Vector3(side * x, 0, 30), new THREE.Vector3(0, 0, -1))
              const hits = ray.intersectObjects([...book.used.values()].map(leaf => leaf.mesh))
              assert(hits[0]?.object === page.mesh, `${count}/${side}/frame-${frame}: pressed page exposed another sheet`)
            }
          }
          book.refreshTextures()
          book.endDrag(0, false); tick(book); check(`${count}/roundtrip/${cycle}/${side}`)
        }
        assert(book.settledTurned === 0 && book.pageSurface(1)?.key === 0, 'first page did not return')
      }
      book.jumpTo(0); book.update(0)
      assert(book.turn(1, 6) === 6, 'same-direction fan is broken')
      assert(!book.beginDrag(1, .96, .5), 'drag exceeded six flying sheets')
      tick(book); check(`${count}/fan`)
    } finally {
      book.dispose(); for (const t of textures.values()) t.dispose()
    }
    onProgress({ checks, cases, failures })
  }
  return { checks, cases, failures }
}
