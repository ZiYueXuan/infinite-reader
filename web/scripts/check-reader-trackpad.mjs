// Browser regression against a local sample, without cloud writes or AI requests.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 900 } })
const page = await browser.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
  // A preference saved by the previous release must not override the new behavior.
  localStorage.setItem('infinite-reader:prefs:v1', JSON.stringify({ readerScrollMode: 'mouse' }))
})
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
const ready = () => page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5199/?sample=zh', { waitUntil: 'domcontentloaded' })
  await ready()
  const result = await page.evaluate(() => {
    const r = __reader
    r.resetView(); r.advance(3); r.renderNow()
    const before = { ...r.view }, turned = r.turnedLeaves
    const center = r.unproject(720, 450, 0)
    const wheel = values => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 720, clientY: 450, ...values })
      r.canvas.dispatchEvent(e); return e.defaultPrevented
    }
    let captured = true
    for (let i = 0; i < 10; i++) captured = wheel({ deltaX: 10, deltaY: 8 }) && captured
    const noZoom = r.view.tzoom === before.tzoom
    r.advance(3); r.renderNow()
    const projected = r.project(center.x, center.y, 0)
    const pan = projected.x < 640 && projected.y < 390 && r.turnedLeaves === turned
    const at = { ...r.view }
    r.suspendInteraction(true); wheel({ deltaX: 100, deltaY: 100 }); r.suspendInteraction(false)
    const suspended = r.view.tx === at.tx && r.view.ty === at.ty
    const base = r.view.tzoom
    wheel({ deltaY: -100, ctrlKey: true })
    const pinch = r.view.tzoom > base && r.view.tzoom / base < 1.13
    r.resetView(); r.advance(3); r.renderNow()
    const gesture = (type, scale) => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(e, { scale, clientX: 720, clientY: 450 }); r.canvas.dispatchEvent(e)
    }
    const z = r.view.tzoom
    gesture('gesturestart', 1); gesture('gesturechange', 1.2)
    const native = Math.abs(r.view.tzoom - z * 1.2) < .001
    const v = { ...r.view }
    wheel({ deltaX: 30, deltaY: 30 }); wheel({ deltaY: -100, ctrlKey: true })
    const duplicate = r.view.tzoom === v.tzoom && r.view.tx === v.tx && r.view.ty === v.ty
    gesture('gestureend', 1.2)
    return { captured, noZoom, pan, projected, suspended, pinch, native, duplicate }
  })
  for (const key of ['captured', 'noZoom', 'pan', 'suspended', 'pinch', 'native', 'duplicate']) check(result[key], key + (key === 'pan' ? JSON.stringify(result.projected) : ''))
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready()
  const cdp = await page.createCDPSession()
  await page.evaluate(() => { __reader.resetView(); __reader.advance(3); __reader.renderNow() })
  const prior = await page.evaluate(() => ({ ...__reader.view }))
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1100, y: 500, deltaX: 40, deltaY: 50 })
  await page.waitForFunction(v => __reader.view.tx !== v.tx && __reader.view.ty !== v.ty, {}, prior)
  check(await page.evaluate(v => __reader.view.tzoom === v.tzoom && visualViewport.scale === 1, prior), 'Mac scroll pans after reload despite legacy mouse preference')
  for (const modifiers of [2, 4]) {
    const z = await page.evaluate(() => __reader.view.tzoom)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1100, y: 500, deltaX: 0, deltaY: -100, modifiers })
    await page.waitForFunction(z => __reader.view.tzoom > z, {}, z)
    check(await page.evaluate(z => __reader.view.tzoom / z < 1.13 && visualViewport.scale === 1, z), 'Ctrl/Command + scroll gently zooms the reader')
  }
  await page.evaluate(() => {
    const indicator = document.querySelector('.dock-indicator')
    if (indicator.getAttribute('aria-expanded') !== 'true') indicator.click()
    document.querySelector('.tilt-wrap > button').click()
  })
  await page.waitForSelector('.tilt-pop')
  check(await page.$('.reader-scroll-modes') === null, 'no input-mode switch remains')
  check(errors.length === 0, errors.join('; ') || 'no browser errors')
} finally { await browser.close() }
