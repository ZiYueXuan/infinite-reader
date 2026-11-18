// Real bundled Chinese EPUB/font subsets; inject a transient font CDN failure.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
try {
  const page = await browser.newPage(), errors = [], attempts = new Map()
  let failedUrl
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/')) return void request.respond({ status: path.endsWith('/me') ? 401 : 200, contentType: 'application/json',
      body: path.endsWith('/me') ? '{"error":{"code":"unauthorized","message":"Unauthorized"}}' : '{"email":true,"google":false}' })
    if (path.includes('lxgw-wenkai') && path.endsWith('.woff2')) {
      attempts.set(path, (attempts.get(path) ?? 0) + 1)
      if (!failedUrl) {
        failedUrl = path
        return void request.respond({ status: 503, body: 'Temporarily unavailable' })
      }
    }
    void request.continue()
  })
  await page.goto(new URL('/shelf?sample=zh&lang=en', process.env.READER_URL || 'http://127.0.0.1:5202').href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  assert(failedUrl, 'the fixture must load real Chinese font subsets')
  assert(attempts.get(failedUrl) >= 2, 'failed subset must be fetched again')
  assert.equal(await page.evaluate(() => window.__store.getState().error), null)
  assert(await page.evaluate(() => document.fonts.check('500 22px "LXGW WenKai"', '阅读')))
  assert.deepEqual(errors, [])
  const fontBytes = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('lxgw-wenkai') && r.name.includes('.woff2')).reduce((sum, r) => sum + r.encodedBodySize, 0))
  assert(fontBytes < 7231496 / 2, 'a sample must not download the entire default font')
  assert(attempts.size > 1, 'the default font is split into character subsets')
  console.log('PASS Chinese sample opens in the requested font after a transient subset failure', { subsets: attempts.size, fontBytes, failedSubsetAttempts: attempts.get(failedUrl) })
} finally { await browser.close() }
