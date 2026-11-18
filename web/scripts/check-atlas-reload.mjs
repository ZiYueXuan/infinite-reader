// Production-build browser regression: stale lazy-module URL -> full reload -> working globe.
// The map/image are fixtures. All account APIs are intercepted; no AI calls or user data writes.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } })
try {
  const page = await browser.newPage(), errors = []
  page.setDefaultTimeout(120000); page.on('pageerror', e => errors.push(e.message))
  let breakModule = true, blocked = 0, recognitionRequests = 0
  await page.setRequestInterception(true)
  page.on('request', req => {
    const url = new URL(req.url())
    if (/\/assets\/AtlasMap-.*\.js$/.test(url.pathname) && breakModule) {
      blocked++; return void req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Old asset missing</title>' })
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.endsWith('/atlas')) recognitionRequests++
      return void req.respond({ status: 401, contentType: 'application/json', body: '{"error":{"message":"Not signed in"}}' })
    }
    // Unavailable optional external DEM must still leave the bundled globe usable.
    if (url.hostname === 's3.amazonaws.com') return void req.abort('internetdisconnected')
    if (url.hostname === 'static.cloudflareinsights.com') return void req.abort()
    void req.continue()
  })
  const openMap = async () => {
    await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading)
    await page.evaluate(() => {
      const map = { id: 'saved-fixture', title: 'Saved atlas fixture', period: '', number: '1',
        bounds: [[43, 27], [64, 42]], center: [53, 34], image: { sha256: '', bytes: 0 },
        places: [{ id: 'tabriz', name: '大不里士', modernName: 'Tabriz', coordinates: [46.29, 38.08], imagePoint: [.4, .4] }],
        recognition: { model: 'fixture', unresolved: [] } }
      const s = window.__store.getState()
      s.current.parsed.getImage = async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#d5d0b7"/><text x="20" y="50">Saved map</text></svg>'], { type: 'image/svg+xml' })
      window.__reader.hooks.onImageClick('fixture.svg', map)
    })
    await page.waitForSelector('.image-preview-map:not(:disabled)')
    await page.click('.image-preview-map'); await page.waitForSelector('.book-atlas[open]')
  }
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5202/?sample=zh&lang=en', { waitUntil: 'domcontentloaded' })
  await openMap()
  await page.waitForFunction(() => document.querySelector('.atlas-map-status button')?.textContent === 'Refresh page')
  assert.equal(blocked, 1)
  assert.equal(await page.$('.atlas-map-canvas'), null)
  assert.match(await page.$eval('.atlas-map-status', el => el.textContent), /Saved recognition results will be kept/)
  assert.equal(await page.$$eval('.atlas-places button', els => els.length), 1)
  const bookUrl = page.url()
  console.log('PASS a missing hashed module shows page-refresh recovery and preserves original/map places')
  breakModule = false
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('.atlas-map-status button')])
  assert.equal(page.url(), bookUrl)
  await openMap()
  await page.waitForSelector('.atlas-map-controls button:not(:disabled)')
  assert.ok(await page.$('.maplibregl-canvas'))
  assert.equal(await page.$('.atlas-map-status'), null)
  assert.ok(await page.$('.atlas-map-notice'))
  await page.click('.atlas-map-controls button:nth-child(2)')
  await page.waitForFunction(() => document.querySelector('.atlas-map-canvas')?.dataset.labels === 'hidden')
  await page.screenshot({ path: '/tmp/atlas-reload-globe.png' })
  assert.equal(recognitionRequests, 0)
  assert.deepEqual(errors, [])
  console.log('PASS full reload recovers globe and controls; unavailable DEM retains bundled map; no recognition calls or runtime errors')
} finally { await browser.close() }
