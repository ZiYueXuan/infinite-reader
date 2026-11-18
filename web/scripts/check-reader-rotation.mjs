// Local-only iPad rotation regression, including delayed viewport measurements and blocked reflow.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true })
const page = await browser.newPage(), errors = [], api = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()) })
await page.emulate({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', viewport: { width: 744, height: 1133, deviceScaleFactor: 2, isMobile: true, hasTouch: true } })
await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'standalone', { value: true }))
const rotate = async landscape => {
  await page.setViewport({ width: landscape ? 1133 : 744, height: landscape ? 744 : 1133, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')))
}
const fitted = async () => {
  await page.waitForFunction(() => {
    const r = __reader, c = r.pagination.config, paper = document.querySelectorAll('.text-page')[1].getBoundingClientRect()
    return c.pageW === innerWidth && c.pageH === innerHeight && !r.viewportNeedsReflow &&
      Math.abs(paper.top) < 2 && Math.abs(paper.bottom - innerHeight) < 2
  }, { timeout: 15000 })
}
const position = () => page.evaluate(() => { const r = __reader, p = r.pagination.pages[r.visiblePages.right]; return { chapter: p.chapter, start: p.start, end: p.end } })
try {
  await page.goto(`${process.env.READER_ORIGIN || 'http://127.0.0.1:5198'}/?sample=zh&lang=zh-CN`)
  await page.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading, { timeout: 120000 })
  await page.evaluate(() => __reader.goToLeaf(2)); await fitted()
  for (let i = 0; i < 2; i++) { await rotate(true); await fitted(); await rotate(false); await fitted() }
  check(true, 'repeated portrait-landscape-portrait cycles fill the page without letterboxing')
  await rotate(true); await fitted()
  const before = await position()
  await page.evaluate(() => __store.setState({ loading: { progress: .5, label: 'Delayed load fixture' } }))
  await rotate(false); await delay(1300)
  check(await page.evaluate(() => __reader.pagination.config.pageW === 1133), 'rotation waits while a book/font load owns pagination')
  await page.evaluate(() => __store.setState({ loading: null })); await fitted()
  const after = await position()
  check(after.chapter === before.chapter && after.start <= before.start && after.end >= before.start, 'finishing the load replays the pending portrait layout and preserves the passage')

  await rotate(true); await fitted()
  await page.evaluate(() => {
    const input = document.createElement('textarea'); input.id = 'rotation-input'; input.dataset.ui = ''
    input.style.cssText = 'position:fixed;top:100px;left:100px;z-index:9999'; document.body.append(input); input.focus()
  })
  await rotate(false); await delay(1300)
  check(await page.evaluate(() => __reader.pagination.config.pageW === 1133), 'active text entry defers pagination during keyboard/rotation changes')
  await page.evaluate(() => { document.getElementById('rotation-input').blur(); document.getElementById('rotation-input').remove() })
  await fitted()
  check(true, 'blur replays a deferred viewport request without another resize event')

  // A non-keyboard control must not block a viewport correction.
  await rotate(true); await fitted()
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'rotation-range'; input.type = 'range'; input.dataset.ui = ''
    input.style.cssText = 'position:fixed;top:100px;left:100px;z-index:9999'; document.body.append(input); input.focus()
  })
  await rotate(false); await fitted()
  check(await page.evaluate(() => document.activeElement?.id === 'rotation-range'), 'focused range controls do not prevent portrait pagination')
  await page.evaluate(() => document.getElementById('rotation-range').remove())

  // Model a WebKit orientation event that still exposes the old container rectangle.
  await page.evaluate(() => {
    const el = document.querySelector('.desk'), measure = el.getBoundingClientRect, old = measure.call(el)
    el.getBoundingClientRect = () => old
    window.setTimeout(() => { el.getBoundingClientRect = measure }, 300)
  })
  await rotate(true); await fitted()
  check(true, 'settling probes recover when the first resize reports stale dimensions')
  await rotate(false); await fitted()

  // A late font/book operation may commit an old layout without any further DOM resize.
  await page.evaluate(() => { window.__portraitPagination = __reader.pagination })
  await rotate(true); await fitted()
  await page.evaluate(() => { __reader.reflow(window.__portraitPagination); delete window.__portraitPagination })
  await fitted()
  check(true, 'a late old-layout commit is reconciled with the current viewport')
  await rotate(false); await fitted()
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); document.dispatchEvent(new Event('visibilitychange')); visualViewport.dispatchEvent(new Event('resize')) })
  await fitted()
  check(true, 'resume and visual-viewport events keep the full portrait page')
  await page.screenshot({ path: '/tmp/ipad-rotation-after.png' })
  check(api.length === 0, 'rotation checks never call production APIs')
  check(errors.length === 0, `no runtime errors: ${errors.join('; ')}`)
} finally { await browser.close() }
