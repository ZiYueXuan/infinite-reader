// Run in the existing browser against Vite:
//   const { checkTextSelection } = await import('/scripts/check-text-selection.mjs')
//   checkTextSelection(window.__reader)
import { contentOrigin, renderPage } from '../src/book/pageRender.ts'
import { MARK_COLORS } from '../src/book/annotations.ts'

export function checkTextSelection(reader, counts = [8, 81, 700]) {
  const original = reader.loaded
  const source = original.pag.pages.filter(p => !p.special && p.lines.length)
  const cfg = original.pag.config
  const saved = { view: { ...reader.view }, tilt: reader.debugTilt, turned: reader.book.settledTurned, paused: reader.paused }
  const failures = []
  let probes = 0, caretChecks = 0, maxPageError = 0
  try {
    reader.clearSelection()
    reader.paused = true
    for (const count of counts) {
      const pages = Array.from({ length: count * 2 }, (_, i) => ({ ...source[i % source.length], index: i }))
      reader.loadBook({ ...original, pag: { ...original.pag, pages }, turned: 1 }, true)
      for (const turned of [Math.max(1, Math.floor(count * 0.01)), count - Math.max(1, Math.floor(count * 0.01))]) {
        reader.book.jumpTo(turned)
        reader.book.update(0)
        for (const tilt of [0, 0.55]) for (const zoom of [0.9, 1.8]) {
          reader.debugTilt = tilt
          Object.assign(reader.view, { x: 0, y: 0, tx: 0, ty: 0, zoom, tzoom: zoom, focus: false })
          reader.renderNow()
          for (const slot of [0, 1]) {
            const page = reader.text.pageIn(slot)
            const side = slot ? 1 : -1
            const surface = reader.book.pageSurface(side)
            // Rendering disables frustum culling; raycasting still needs bounds refreshed after reuse.
            surface.geo.computeBoundingSphere()
            const origin = contentOrigin(page, cfg)
            const lines = page.lines.filter(l => l.words.some(w => w.s >= 0))
            for (const line of lines.filter((_, i) => i % Math.max(1, Math.floor(lines.length / 4)) === 0)) {
              const words = line.words.filter(w => w.s >= 0)
              for (const word of new Set([words[0], words[Math.floor(words.length / 2)], words.at(-1)])) {
                const el = reader.text.slots[slot].el.querySelector(`span.w[data-s="${word.s}"]`)
                const matrix = new DOMMatrix(el.style.transform)
                for (const fraction of [0.1, 0.5, 0.9]) {
                  const localY = line.baseline - word.size * 0.3
                  const p = new DOMPoint(word.w * fraction, localY).matrixTransform(matrix)
                  const x = p.x / p.w, y = p.y / p.w
                  // Raycast the actual mesh independently of the overlay's surface sampler.
                  reader.raycaster.setFromCamera({ x: x / reader.w * 2 - 1, y: 1 - y / reader.h * 2 }, reader.camera)
                  const hit = reader.raycaster.intersectObject(surface.mesh, false)[0]
                  const dx = hit ? (slot ? hit.uv.x : 1 - hit.uv.x) * cfg.pageW - origin.x - word.x - word.w * fraction : Infinity
                  const dy = hit ? (1 - hit.uv.y) * cfg.pageH - origin.y - line.y - localY : Infinity
                  const error = Math.hypot(dx, dy)
                  maxPageError = Math.max(maxPageError, error)
                  probes++
                  if (error > 1.25) failures.push({ count, turned, tilt, zoom, side, text: word.text, error })
                  // Actual browser caret lookup at the left/right of a printed ideograph.
                  if (/^[\u4e00-\u9fff]$/.test(word.text) && fraction !== 0.5 && x > 0 && x < reader.w && y > 60 && y < reader.h - 90) {
                    const over = document.elementFromPoint(x, y)
                    if (over?.closest('[data-ui]')) continue
                    const caret = document.caretRangeFromPoint(x, y)
                    const expected = fraction < 0.5 ? 0 : 1
                    const ok = caret?.startContainer === el.firstChild && caret.startOffset === expected
                    caretChecks++
                    if (!ok) failures.push({ count, turned, tilt, zoom, side, text: word.text, caret: true, expected, actual: caret?.startOffset })
                  }
                }
              }
            }
          }
        }
      }
    }
    // A saved highlight must have a uniform horizontal wash, including former glyph boundaries.
    const page = source.find(p => p.lines.some(l => l.words.length > 10))
    const line = page.lines.find(l => l.words.length > 10)
    const words = line.words.filter(w => w.s >= 0)
    const start = words[0].s, end = words.at(-1).e
    const cleanPage = { ...page, images: [], rules: [], lines: page.lines.map(l => ({ ...l, words: l.words.map(w => ({ ...w, text: '' })) })) }
    const origin = contentOrigin(page, cfg)
    const y = Math.round(origin.y + line.y + line.baseline - cfg.fontSize * 0.25)
    const x0 = Math.ceil(origin.x + words[0].x + 8), x1 = Math.floor(origin.x + words.at(-1).x + words.at(-1).w - 8)
    for (const color of Object.keys(MARK_COLORS)) {
      const canvas = renderPage(cleanPage, { cfg, scale: 1, bookTitle: '', author: '', images: new Map(), marks: [{ id: 'wash-check', locator: { chapter: page.chapter, start, end }, color, kind: 'highlight' }] })
      const pixels = canvas.getContext('2d').getImageData(x0, y, x1 - x0, 1).data
      for (let c = 0; c < 3; c++) {
        const values = Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + c])
        if (Math.max(...values) - Math.min(...values) > 1) failures.push({ color, wash: true, channel: c })
      }
    }
  } finally {
    reader.loadBook({ ...original, turned: saved.turned }, true)
    Object.assign(reader.view, saved.view)
    reader.debugTilt = saved.tilt
    reader.paused = saved.paused
    reader.renderNow()
  }
  return { probes, caretChecks, colors: Object.keys(MARK_COLORS).length, maxPageError, failures }
}
