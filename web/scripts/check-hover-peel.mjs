// Run in the existing in-app browser against Vite:
//   const { checkHoverPeel } = await import('/scripts/check-hover-peel.mjs')
//   checkHoverPeel(window.__reader)
import { BookModel } from '../src/engine/book.ts'
import { GRID_U, GRID_V } from '../src/engine/leafMesh.ts'

export function checkHoverPeel(reader) {
  const book = new BookModel({ leafCount: 81, turned: 40, open: true, cover: reader.loaded.cover, getTexture: () => null })
  const results = []
  const settle = () => { for (let i = 0; i < 40; i++) book.update(1 / 60) }
  const positions = (side) => book.pageSurface(side).geo.attributes.position.array
  try {
    book.update(0)
    const baselines = new Map([-1, 1].map((side) => [side, positions(side).slice()]))
    const peak = (side) => {
      const p = positions(side), base = baselines.get(side)
      const lifts = Array.from({ length: GRID_V }, (_, row) => {
        const k = (row * GRID_U + GRID_U - 1) * 3 + 2
        return p[k] - base[k]
      })
      const height = Math.max(...lifts)
      return { height, v: lifts.indexOf(height) / (GRID_V - 1) }
    }
    for (const side of [-1, 1]) {
      book.setPeel(0, side, 0.5)
      settle()
      for (const v of [0, 0.25, 0.5, 0.75, 1, 0]) {
        const previous = peak(side)
        book.setPeel(1, side, v)
        const follows = !book.isStatic
        book.update(1 / 60)
        const first = peak(side)
        // After lift-off, a position change must animate instead of freezing or teleporting.
        const smooth = previous.height < 0.01 || (Math.abs(first.v - previous.v) < Math.abs(v - previous.v) && first.height > 1)
        settle()
        const end = peak(side)
        results.push({ side, v, peakV: end.v, follows, smooth, ok: follows && smooth && Math.abs(end.v - v) <= 0.021 && end.height > 1 && book.isStatic })
      }
      book.setPeel(0, side, 0.5)
      settle()
      results.push({ side, phase: 'leave', ok: peak(side).height === 0 && book.isStatic })
    }
    // Reuse a full-height corner peel when handing the sheet to a drag, without a geometry pop.
    for (const side of [-1, 1]) {
      book.setPeel(1, side, 0.95)
      settle()
      const mesh = book.pageSurface(side)
      const before = positions(side).slice()
      book.beginDrag(side, 0.96, 0.95)
      settle()
      const after = mesh.geo.attributes.position.array
      const dx = Math.max(...Array.from({ length: before.length / 3 }, (_, i) => Math.abs(after[i * 3] - before[i * 3])))
      results.push({ side, phase: 'grab', maxDx: dx, ok: dx < 0.0006 })
      book.jumpTo(40)
      book.update(0)
    }
  } finally { book.dispose() }
  return { checks: results.length, failures: results.filter((r) => !r.ok), results }
}
