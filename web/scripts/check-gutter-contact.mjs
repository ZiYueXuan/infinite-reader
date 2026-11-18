// Run in the existing browser against a local Vite server; no separate browser process is needed:
//   const { checkGutterContact } = await import('/scripts/check-gutter-contact.mjs')
//   checkGutterContact(window.__reader)
//
// Check rendered mesh cross-sections, including the intervals between simulation nodes. Testing only
// vertices misses the narrow strips where differently sampled gutter curves cross through each other.
import { BookModel } from '../src/engine/book.ts'
import { GRID_U, GRID_V } from '../src/engine/leafMesh.ts'

function clearance(book) {
  let gap = Infinity
  const resting = [-1, 1].flatMap((side) => book.restList(side, 1).map((k) => book.used.get(k)))
  for (const flyer of book.flyers) {
    const moving = flyer.mesh.geo.attributes.position.array
    for (const leaf of resting) {
      const below = leaf.geo.attributes.position.array
      for (let row = 0; row < GRID_V; row++) {
        for (let i = 0; i < GRID_U - 1; i++) {
          const a = (row * GRID_U + i) * 3
          const ax = moving[a], bx = moving[a + 3]
          if (Math.abs(bx - ax) < 1e-7) continue
          for (let j = 0; j < GRID_U - 1; j++) {
            const c = (row * GRID_U + j) * 3
            const cx = below[c], dx = below[c + 3]
            const lo = Math.max(Math.min(ax, bx), Math.min(cx, dx))
            const hi = Math.min(Math.max(ax, bx), Math.max(cx, dx))
            if (hi - lo < 1e-7) continue
            for (const x of [lo, hi]) {
              const z = moving[a + 2] + (moving[a + 5] - moving[a + 2]) * (x - ax) / (bx - ax)
              const floor = below[c + 2] + (below[c + 5] - below[c + 2]) * (x - cx) / (dx - cx)
              gap = Math.min(gap, z - floor)
            }
          }
        }
      }
    }
  }
  return gap
}

export function checkGutterContact(reader, counts = [8, 81, 700, 1600]) {
  const results = []
  try {
    for (const count of counts) for (const side of [1, -1]) for (const grab of [0.08, 0.5, 0.92]) {
      const nearStart = Math.max(1, Math.floor(count * 0.01))
      const turned = side === 1 ? nearStart : count - nearStart
      const book = new BookModel({ leafCount: count, turned, open: true, cover: reader.loaded.cover, getTexture: () => null })
      try {
        book.update(0)
        if (!book.beginDrag(side, 0.96, grab)) throw new Error('Could not start the test drag')
        for (const travel of [0, 0.005, 0.02, 0.06, 0.18, 0.45, 0.7, 0.98]) {
          book.moveDrag(side * book.W * 0.96 * (1 - 2 * travel), (grab - 0.5) * book.H)
          let minGap = Infinity
          for (let frame = 0; frame < 24; frame++) {
            book.update(1 / 60)
            if (frame % 6 === 0 || frame === 23) minGap = Math.min(minGap, clearance(book))
          }
          results.push({ count, side, grab, travel, minGap, ok: minGap >= -0.0001 })
        }
        book.endDrag(0, true)
        for (let frame = 0; frame < 240 && book.busy; frame++) book.update(1 / 60)
        results.push({ count, side, grab, phase: 'land', ok: !book.busy && book.settledTurned === turned + side })

        book.jumpTo(turned)
        book.setPeel(0.12, side, grab)
        for (let frame = 0; frame < 24; frame++) book.update(1 / 60)
        book.beginDrag(side, 0.96, grab)
        book.moveDrag(side * book.W * 0.96 * 0.96, (grab - 0.5) * book.H)
        for (let frame = 0; frame < 24; frame++) book.update(1 / 60)
        book.endDrag(0, true)
        let returnGap = Infinity
        for (let frame = 0; frame < 240 && book.busy; frame++) {
          book.update(1 / 60)
          if (frame % 6 === 0) returnGap = Math.min(returnGap, clearance(book))
        }
        results.push({ count, side, grab, phase: 'return', minGap: returnGap, ok: returnGap >= -0.0001 && !book.busy && book.settledTurned === turned })
      } finally {
        book.dispose()
      }
    }
  } finally {
    // Book models share the shadow uniforms; restore the visible reader after probing detached models.
    reader.book.update(0)
    reader.renderNow()
  }
  return { checks: results.length, failures: results.filter((r) => !r.ok), minimumGap: Math.min(...results.map((r) => r.minGap ?? Infinity)) }
}
