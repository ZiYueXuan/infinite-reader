// Compare the final moving mesh with the resting mesh, including thick books.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5187/?sample=zh')
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  const results = await page.evaluate(async () => {
    const { BookModel } = await import('/src/engine/book.ts')
    const r = window.__reader, results = []
    r.paused = true
    for (const leaves of [8, 400]) for (const direction of [1, -1]) for (const mode of ['key', 'multi', 'handoff', 'cancel']) {
      const start = Math.floor(leaves * .7)
      const b = new BookModel({ leafCount: leaves, turned: start, open: true, cover: r.loaded.cover, getTexture: () => r.tex.get(0) })
      b.update(0)
      if (mode === 'handoff') {
        b.turn(direction)
        for (let i = 0; i < 42; i++) b.update(1 / 60)
        b.turn(direction, 1, 'quick')
      } else if (mode === 'cancel') {
        b.setPeel(1, direction, .5)
        for (let i = 0; i < 30; i++) b.update(1 / 60)
        b.beginDrag(direction, .94, .5)
        b.endDrag(0, true)
        b.turn(direction, 1, 'quick')
      } else b.turn(direction, mode === 'multi' ? 3 : 1, 'quick')
      let jumpX = 0, jumpZ = 0, settled = 0, lateX = 0, lateZ = 0
      const snapshot = f => new Float32Array(f.mesh.geo.attributes.position.array)
      for (let i = 0; i < 120 && b.busy; i++) {
        const before = b.flyers.map(f => ({ f, vertices: snapshot(f) }))
        b.update(1 / 60)
        for (const { f, vertices } of before) {
          if (!b.flyers.includes(f)) {
            const after = f.mesh.geo.attributes.position.array
            for (let k = 0; k < after.length; k += 3) {
              jumpX = Math.max(jumpX, Math.abs(after[k] - vertices[k]))
              jumpZ = Math.max(jumpZ, Math.abs(after[k + 2] - vertices[k + 2]))
            }
            settled++
          }
        }
      }
      // The newly landed page must remain still for the following second.
      const meshes = [...b.used.values()].map(m => ({ m, vertices: new Float32Array(m.geo.attributes.position.array) }))
      for (let i = 0; i < 60; i++) b.update(1 / 60)
      for (const { m, vertices } of meshes) for (let k = 0; k < vertices.length; k += 3) {
        lateX = Math.max(lateX, Math.abs(m.geo.attributes.position.array[k] - vertices[k]))
        lateZ = Math.max(lateZ, Math.abs(m.geo.attributes.position.array[k + 2] - vertices[k + 2]))
      }
      results.push({ leaves, direction, mode, jumpX, jumpZ, lateX, lateZ, settled, busy: b.busy, turned: b.settledTurned,
        expected: start + (mode === 'cancel' ? 0 : direction * (mode === 'multi' ? 3 : 1)) })
      b.dispose()
    }
    return results
  })
  for (const result of results) {
    console.log(JSON.stringify(result))
    assert.ok(result.settled > 0 && !result.busy, 'the moving leaf settles')
    assert.equal(result.turned, result.expected, 'landing preserves page order')
    assert.ok(result.jumpX < .001 && result.jumpZ < .001, 'moving/resting meshes match within 0.001 book units')
    assert.equal(result.lateX, 0, 'no delayed horizontal movement')
    assert.equal(result.lateZ, 0, 'no delayed vertical movement')
  }
  assert.deepEqual(errors, [])
  console.log(`PASS ${results.length} page landing cases`)
} finally { await browser.close() }
