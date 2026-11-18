// Browser UI checks with controllable fullscreen APIs; local sample, no AI calls.
// Set NATIVE_FULLSCREEN=1 (and optionally HEADED=1) to exercise the platform implementation.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: !process.env.HEADED,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 900 } })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  if (!process.env.NATIVE_FULLSCREEN) await page.evaluateOnNewDocument(() => {
    let element = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    HTMLElement.prototype.requestFullscreen = async function () {
      if (!navigator.userActivation.isActive) throw new Error('Missing user activation')
      element = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    document.exitFullscreen = async () => { element = null; document.dispatchEvent(new Event('fullscreenchange')) }
  })
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5187/?sample=zh&lang=en')
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  await page.evaluate(() => {
    window.__reader.paused = true
    window.__fitCalls = 0
    window.__sayMessages = []
    const say = window.__store.getState().say
    window.__store.setState({ say: text => { window.__sayMessages.push(text); say(text) } })
    const scene = window.__reader, reset = scene.resetView.bind(scene)
    scene.resetView = () => { window.__fitCalls++; reset() }
  })
  const reveal = async () => {
    if (await page.$eval('.dock-indicator', e => e.getAttribute('aria-expanded') === 'false')) await page.click('.dock-indicator')
    await page.waitForFunction(() => document.querySelector('.dock')?.getAttribute('aria-hidden') === 'false' && getComputedStyle(document.querySelector('.dock')).opacity === '1' && document.querySelector('.dock').getAnimations().length === 0)
    await page.focus('.fullscreen-toggle')
  }
  const click = async selector => {
    await page.waitForSelector(selector + ':not(:disabled)')
    await page.$eval(selector, button => button.click())
  }
  await reveal()
  assert.equal(await page.$eval('.fullscreen-toggle', e => e.disabled), false)
  await click('.fullscreen-toggle')
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement)
  await page.waitForSelector('.fullscreen-toggle[aria-pressed="true"]')
  assert.equal(await page.evaluate(() => window.__fitCalls), 0)
  assert.equal(await page.$eval('.fullscreen-toggle', e => e.title), 'Exit fullscreen (Esc)')
  await click('.fit-book')
  assert.equal(await page.evaluate(() => window.__fitCalls), 1)
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), true)
  await click('.fullscreen-toggle')
  await page.waitForFunction(() => !document.fullscreenElement)
  await page.waitForSelector('.fullscreen-toggle[aria-pressed="false"]')
  console.log('PASS fullscreen entry/exit API wiring; Fit remains independent in fullscreen')
  await click('.fit-book')
  assert.equal(await page.evaluate(() => window.__fitCalls), 2)
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), false)
  // A browser-driven exit (Escape uses the same fullscreenchange notification).
  await click('.fullscreen-toggle')
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.evaluate(() => document.exitFullscreen())
  await page.waitForSelector('.fullscreen-toggle[aria-pressed="false"]')
  assert.equal(await page.$eval('.fullscreen-toggle', e => e.title), 'Enter fullscreen')
  console.log('PASS external exit synchronizes the button')
  await page.evaluate(() => {
    window.__requestFullscreen = document.documentElement.requestFullscreen
    document.documentElement.requestFullscreen = () => Promise.reject(new Error('Denied for test'))
  })
  await reveal(); await click('.fullscreen-toggle')
  await page.waitForFunction(() => !document.querySelector('.fullscreen-toggle').disabled)
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), false)
  await page.waitForFunction(() => window.__sayMessages.some(text => text.includes('Could not enter fullscreen')))
  await page.evaluate(() => { document.documentElement.requestFullscreen = window.__requestFullscreen })
  console.log('PASS rejected fullscreen request reports an error and releases the control')
  for (const width of [1440, 375, 320]) {
    await page.setViewport({ width, height: 900 }); await reveal()
    const layout = await page.evaluate(() => {
      const dock = document.querySelector('.dock'), r = dock.getBoundingClientRect()
      return { within: r.left >= 0 && r.right <= innerWidth && r.top >= 0, overflow: dock.scrollWidth > dock.clientWidth,
        separate: document.querySelector('.fullscreen-toggle svg').innerHTML !== document.querySelector('.fit-book svg').innerHTML }
    })
    assert.deepEqual(layout, { within: true, overflow: false, separate: true })
  }
  await page.evaluate(() => { localStorage.setItem('ir:locale', 'zh-CN'); window.dispatchEvent(new StorageEvent('storage', { key: 'ir:locale', newValue: 'zh-CN' })) })
  await page.waitForSelector('.fullscreen-toggle[aria-label="进入全屏阅读"]')
  assert.equal(await page.$eval('.fit-book', e => e.title), '书籍适应屏幕（0）')
  await page.screenshot({ path: '/tmp/reader-fullscreen-mobile.png' })
  console.log('PASS distinct icons, responsive layout and Chinese labels')
  // Remount the reading toolbar under an unsupported Fullscreen API.
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
    const s = window.__store.getState()
    window.__store.setState({ current: { ...s.current, meta: { ...s.current.meta, id: s.current.meta.id + '-unsupported' } } })
  })
  await page.waitForSelector('.fullscreen-toggle:disabled')
  assert.equal(await page.$eval('.fit-book', e => e.disabled), false)
  assert.equal(await page.$eval('.fullscreen-toggle', e => e.title), '当前浏览器不支持全屏阅读')
  console.log('PASS unsupported fullscreen leaves Fit available')
  // Older Safari exposes the same operation through prefixed methods/events.
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = undefined
    let element = null
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => element })
    Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: true })
    document.documentElement.webkitRequestFullscreen = () => { element = document.documentElement; document.dispatchEvent(new Event('webkitfullscreenchange')) }
    document.webkitExitFullscreen = () => { element = null; document.dispatchEvent(new Event('webkitfullscreenchange')) }
    const s = window.__store.getState()
    window.__store.setState({ current: { ...s.current, meta: { ...s.current.meta, id: s.current.meta.id + '-webkit' } } })
  })
  await reveal(); await click('.fullscreen-toggle'); await page.waitForSelector('.fullscreen-toggle[aria-pressed="true"]')
  await click('.fullscreen-toggle'); await page.waitForSelector('.fullscreen-toggle[aria-pressed="false"]')
  console.log('PASS prefixed Safari API fallback')
  assert.deepEqual(errors, [])
} finally { await browser.close() }
