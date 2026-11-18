// Actual touch events and mesh invariants for the phone rolling fold. Local samples only.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true })
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS', label) }
try {
  const p = await browser.newPage(), errors = []
  p.on('pageerror', e => errors.push(e.message))
  await p.emulate({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', viewport: { width: 430, height: 739, deviceScaleFactor: 3, isMobile: true, hasTouch: true } })
  await p.goto(`${process.env.READER_ORIGIN || 'http://127.0.0.1:5198'}/?sample=zh&lang=zh-CN`)
  await p.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading, { timeout: 120000 })
  await p.evaluate(() => __reader.goToLeaf(2))
  await p.waitForFunction(() => !__reader.book.busy && __reader.visiblePages.right === 2)
  const c = await p.createCDPSession()
  const touch = (type, x, y = 650) => c.send('Input.dispatchTouchEvent', { type, touchPoints: /End|Cancel/.test(type) ? [] : [{ x, y }] })
  const frames = () => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const settled = () => p.waitForFunction(() => !__reader.book.busy)
  const index = () => p.evaluate(() => __reader.visiblePages.right)
  await touch('touchStart', 400); await touch('touchMove', 250)
  await frames()
  const held = await p.evaluate(() => {
    const f = __reader.book.flyers[0], a = f.mesh.geo.attributes.position
    return { positions: [...a.array], flatX: a.getX(0), flatZ: a.getZ(0), height: __reader.book.tb + .01,
      back: f.mesh.uniforms.uPhone.value, phi: f.phi, target: f.pointerPhi }
  })
  check(Math.abs(held.phi - held.target) < 1e-8, 'fold tracks the pointer within the next rendered frame')
  check(held.flatX === 0 && Math.abs(held.flatZ - held.height) < 1e-6, 'unturned text stays flat at its original coordinates')
  check(held.back === 1, 'rolling sheet uses the mirrored, translucent phone verso')
  await new Promise(r => setTimeout(r, 140))
  check(await p.evaluate(before => __reader.book.flyers[0].mesh.geo.attributes.position.array.every((v, i) => v === before[i]), held.positions), 'holding the finger still produces no spring drift')
  await touch('touchMove', 350); await frames()
  check(await p.evaluate(phi => __reader.book.flyers[0].phi < phi, held.phi), 'pulling back immediately unrolls the same sheet')
  await touch('touchCancel'); await settled()
  check(await index() === 2, 'cancelled curl returns to the exact page')
  await touch('touchStart', 400); await touch('touchMove', 365)
  await new Promise(r => setTimeout(r, 160)); await touch('touchEnd'); await settled()
  check(await index() === 2, 'short drag with no flick returns to the page')
  await touch('touchStart', 400)
  for (let x = 380; x >= 180; x -= 20) { await touch('touchMove', x); await new Promise(r => setTimeout(r, 16)) }
  const release = Date.now(); await touch('touchEnd'); await settled()
  check(await index() === 3, 'deliberate drag commits one adjacent page')
  check(Date.now() - release < 650, 'release completes promptly without a long spring tail')
  await touch('touchStart', 40, 150)
  for (let x = 60; x <= 280; x += 20) { await touch('touchMove', x, 150); await new Promise(r => setTimeout(r, 16)) }
  await touch('touchEnd'); await settled()
  check(await index() === 2, 'backward drag reveals the preceding page')
  await p.evaluate(() => __reader.goToLeaf(7)); await settled(); await frames()
  check(await index() === 7, 'progress seeking reaches the requested page without a multi-leaf fan')
  check(errors.length === 0, `no runtime errors: ${errors.join('; ')}`)
} finally { await browser.close() }
