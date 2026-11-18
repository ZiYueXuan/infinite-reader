import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const base = process.env.READER_BASE || 'http://127.0.0.1:5200'
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 900 } })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base, { waitUntil: 'networkidle0' })
  // Run away from the landing canvas: paper shading is shared by the reader model.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.waitForSelector('.book-story[data-static]')
  const result = await page.evaluate(async () => {
    const { BookModel } = await import('/src/engine/book.ts')
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const texture = new THREE.Texture()
    const cover = { outer: texture, outerBump: texture, inner: texture, cloth: new THREE.Color('#294a3d'), glossy: false, accent: '#294a3d' }
    const options = { leafCount: 96, turned: 48, cover, getTexture: () => texture }
    const snapshot = b => {
      b.group.updateMatrixWorld(true)
      const values = []
      b.group.traverse(o => {
        if (!o.isMesh || !o.visible) return
        values.push(...o.matrixWorld.elements, ...o.geometry.attributes.position.array)
      })
      return values
    }
    let maxError = 0
    for (const open of [false, true]) {
      const normal = new BookModel({ ...options, open })
      const seek = new BookModel({ ...options, open: !open })
      normal.update(0)
      for (const value of [.1, .5, .9, open ? 1 : 0]) { seek.seekOpening(value); seek.update(0) }
      const a = snapshot(normal), b = snapshot(seek)
      if (a.length !== b.length) throw new Error('Seek changed reader model topology')
      for (let i = 0; i < a.length; i++) maxError = Math.max(maxError, Math.abs(a[i] - b[i]))
      normal.dispose(); seek.dispose()
    }
    texture.dispose()
    return { maxError }
  })
  assert.ok(result.maxError < 1e-7, JSON.stringify(result))
  console.log('PASS scroll-seek geometry matches actual reader construction, vertex for vertex')
  await page.goto(`${base}/?sample=zh&lang=zh-CN`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  await page.evaluate(() => { window.__reader.setOpen(true); window.__reader.advance(3) })
  for (const tilt of [0, .44, 1.08]) {
    const pose = await page.evaluate(tilt => {
      const reader = window.__reader
      reader.setTilt(tilt, false); reader.advance(.1); reader.renderNow()
      const c = reader.camera
      return { x: c.position.x, targetX: reader.view.x, up: c.up.toArray(), fov: c.fov, tilt: reader.debugTilt }
    }, tilt)
    assert.ok(Math.abs(pose.x - pose.targetX) < 1e-9)
    assert.deepEqual(pose.up, [0, 1, 0])
    assert.equal(pose.fov, 24)
    assert.equal(pose.tilt, tilt)
    await page.screenshot({ path: `/tmp/showcase-actual-reader-${tilt}.png` })
    console.log('PASS actual reader camera', tilt)
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
