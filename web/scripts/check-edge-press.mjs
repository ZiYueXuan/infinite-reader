// Run inside the existing in-app browser on the local Vite server:
//   const { checkEdgePress } = await import('/scripts/check-edge-press.mjs')
//   await checkEdgePress(window.__reader)
// Detached books keep the reader's saved progress and annotations untouched.
import { BookModel } from '../src/engine/book.ts'

export async function checkEdgePress(reader) {
  const results = []
  try {
    for (const count of [8, 81, 1600]) for (const fraction of [0.02, 0.5, 0.98]) {
      for (const side of [1, -1]) for (const grab of [0.08, 0.5, 0.92]) for (const peel of [0, 0.12]) {
        const turned = Math.max(1, Math.min(count - 1, Math.round(count * fraction)))
        const book = new BookModel({ leafCount: count, turned, open: true, cover: reader.loaded.cover, getTexture: () => null })
        try {
          book.setPeel(peel, side, grab)
          for (let frame = 0; frame < 40; frame++) book.update(1 / 60)
          const mesh = book.pageSurface(side)
          const before = mesh.geo.attributes.position.array.slice()
          if (!book.beginDrag(side, 0.96, grab)) throw new Error('Could not start the test drag')
          let maxDx = 0, maxDz = 0
          for (let frame = 0; frame < 61; frame++) {
            if (frame) book.update(1 / 60)
            const after = mesh.geo.attributes.position.array
            for (let k = 0; k < before.length; k += 3) {
              maxDx = Math.max(maxDx, Math.abs(after[k] - before[k]))
              maxDz = Math.max(maxDz, Math.abs(after[k + 2] - before[k + 2]))
            }
          }
          results.push({ count, turned, side, grab, peel, maxDx, maxDz, ok: maxDx < 0.0006 && maxDz < 0.005 })
        } finally { book.dispose() }
        // Yield between cases so the browser remains responsive while the matrix runs.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  } finally {
    reader.book.update(0)
    reader.renderNow()
  }
  return {
    checks: results.length,
    failures: results.filter((r) => !r.ok),
    maxDx: Math.max(...results.map((r) => r.maxDx)),
    maxDz: Math.max(...results.map((r) => r.maxDz)),
  }
}
