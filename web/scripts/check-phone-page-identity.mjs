// Local sample only. Stress the real GPU depth buffer with a long-book fixture.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true })
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.emulate({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } })
  await page.goto(`${process.env.READER_ORIGIN || 'http://127.0.0.1:5198'}/?sample=zh&lang=zh-CN`)
  await page.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading, { timeout: 120000 })
  // Repeat actual rendered sample pages, preserving distinct adjacent text/images.
  await page.evaluate(() => {
    const r = __reader, loaded = r.loaded
    r.loadBook({ ...loaded, pag: { ...loaded.pag, pages: Array.from({ length: 1600 }, (_, i) => ({ ...loaded.pag.pages[i % loaded.pag.pages.length], index: i })) }, turned: 3 }, true)
  })
  const ready = () => page.waitForFunction(() => !__reader.book.busy && __reader.tex.get(__reader.visiblePages.right).image.width > 4)
  const identity = async label => {
    await ready()
    const result = await page.evaluate(() => {
      const r = __reader, index = r.visiblePages.right, top = r.book.pageSurface(1)
      const mapped = top.uniforms.uFront.value === r.tex.get(index)
      const gl = r.renderer.getContext(), pixels = () => {
        r.renderer.render(r.scene, r.camera)
        const bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
        return bytes
      }
      const actual = pixels(), hidden = []
      for (const mesh of r.book.used.values()) if (mesh !== top && mesh.mesh.visible) { hidden.push(mesh.mesh); mesh.mesh.visible = false }
      const expected = pixels()
      for (const mesh of hidden) mesh.visible = true
      r.needsRender = true
      let changed = 0
      for (let i = 0; i < actual.length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(actual[i + c] - expected[i + c]))) > 3) changed++
      return { index, mapped, changed }
    })
    check(result.mapped && result.changed === 0, `${label}: visible ink matches page ${result.index}; ${result.changed} pixels covered by other pages`)
  }
  const cdp = await page.createCDPSession()
  const touch = (type, x = 350, y = 400, id = 1) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: /End|Cancel/.test(type) ? [] : [{ x, y, id }] })
  const index = () => page.evaluate(() => __reader.visiblePages.right)
  await identity('long book at rest')
  await touch('touchStart'); await touch('touchMove', 345)
  check(await page.evaluate(() => !__reader.book.busy && __reader.visiblePages.right === 3), 'press and finger jitter do not initiate a turn')
  await identity('finger down before drag threshold')
  await touch('touchMove', 320)
  check(await page.evaluate(() => __reader.book.flyers.length === 1 && __reader.book.flyers[0].k === 3 && __reader.book.flyers[0].mesh.uniforms.uFront.value === __reader.tex.get(3)), 'drag carries the same page that was visible before touch')
  await touch('touchCancel'); await ready()
  check(await index() === 3, 'cancel preserves page identity'); await identity('after cancellation')
  const swipe = async (from, to) => {
    await touch('touchStart', from)
    for (let i = 1; i <= 12; i++) { await touch('touchMove', from + (to - from) * i / 12); await new Promise(r => setTimeout(r, 18)) }
    await touch('touchEnd'); await ready()
  }
  for (let i = 4; i <= 6; i++) { await swipe(350, 50); check(await index() === i, `forward swipe reaches adjacent page ${i}`); await identity('after forward swipe') }
  for (let i = 5; i >= 3; i--) { await swipe(50, 350); check(await index() === i, `backward swipe reaches adjacent page ${i}`); await identity('after backward swipe') }
  await touch('touchStart', 200, 300); await touch('touchMove', 202, 340); await touch('touchEnd')
  check(await index() === 3, 'vertical movement never turns pages')
  await page.touchscreen.tap(375, 400); await ready()
  check(await index() === 4, 'edge tap turns one page'); await identity('after edge tap')
  // A touch that starts during animation must not become a queued turn on release.
  await page.evaluate(() => { __reader.paused = true; __reader.turn(1) })
  await touch('touchStart', 375)
  await page.evaluate(() => { __reader.advance(4); __reader.paused = false })
  await touch('touchEnd'); await ready()
  check(await index() === 5, 'press during landing cannot trigger an extra page after release')
  await identity('after overlapping touch')
  await touch('touchStart', 350); await touch('touchMove', 300)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400, id: 1 }, { x: 100, y: 400, id: 2 }] })
  await touch('touchEnd'); await ready()
  check(await index() === 5, 'second finger cancels the held page without an extra tap')
  await identity('after multitouch cancellation')
  await page.touchscreen.tap(195, 400)
  check(await page.$eval('.phone-controls', e => e.dataset.open === 'true'), 'center tap opens controls without turning')
  check(await index() === 5, 'controls preserve the passage')
  check(errors.length === 0, `no runtime errors: ${errors.join('; ')}`)
} finally { await browser.close() }
