// Import from a Vite browser: checkStackEdges(window.__reader).
// Detached books exercise real geometry without changing account data or reader progress.
import { BookModel } from '../src/engine/book.ts'
import { GRID_U } from '../src/engine/leafMesh.ts'

export function checkStackEdges(reader) {
  const results = []
  const inspect = (book, label) => {
    for (const side of [-1, 1]) {
      const leaf = book.pageSurface(side)
      if (!leaf) continue
      const paper = leaf.geo.attributes.position
      const stack = (side === 1 ? book.blockR : book.blockL).mesh.geometry.attributes.position
      // The final pair of cap vertices is its outer edge. It must end under
      // the paper's outer edge, even when gutter curvature shortens the sheet.
      const paperX = paper.getX(GRID_U - 1), capX = stack.getX(stack.count - 2)
      const gap = Math.abs(paperX - capX)
      const capBelow = stack.getZ(stack.count - 2) < paper.getZ(GRID_U - 1)
      const finite = [...stack.array].every(Number.isFinite)
      results.push({ label, side, gap, capBelow, finite, ok: gap < 0.00001 && capBelow && finite })
    }
  }
  try {
    for (const count of [8, 81, 700, 1600]) for (const fraction of [.01, .5, .99]) {
      const turned = Math.max(1, Math.min(count - 1, Math.round(count * fraction)))
      const book = new BookModel({ leafCount: count, turned, open: true, cover: reader.loaded.cover, getTexture: () => null })
      try {
        for (const opening of [0, .35, .7, 1]) {
          book.seekOpening(opening); book.update(0)
          inspect(book, `${count} leaves / ${turned} turned / ${opening} open`)
        }
        for (const direction of [1, -1]) {
          book.turn(direction, 1, 'quick')
          for (let frame = 0; frame < 180 && book.busy; frame++) book.update(1 / 60)
          if (book.busy) throw new Error('Page turn did not settle')
          inspect(book, `${count} leaves / after ${direction} turn`)
        }
      } finally { book.dispose() }
    }
  } finally {
    reader.book.update(0); reader.renderNow()
  }
  return { checks: results.length, maxGap: Math.max(...results.map(r => r.gap)), failures: results.filter(r => !r.ok) }
}
