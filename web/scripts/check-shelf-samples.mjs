// Run against VITE_BACKEND=api. Auth is mocked; both bundled EPUBs are real.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] })
const base = process.env.READER_URL || 'http://127.0.0.1:5175/shelf'
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS', label) }
try {
  for (const order of [['zh', 'alice'], ['alice', 'zh']]) {
    const context = await browser.createBrowserContext(), page = await context.newPage(), writes = [], errors = []
    page.setDefaultTimeout(60000)
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (!path.startsWith('/api/')) return void request.continue()
      if (request.method() !== 'GET') writes.push(path)
      const json = (data, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (path === '/api/auth/me') return void json({ error: { code: 'unauthorized', message: 'Sign in required' } }, 401)
      if (path === '/api/auth/providers') return void json({ email: true, google: true })
      void json({ ok: true })
    })
    const shelf = async () => {
      await page.click('.shelf-up')
      await page.waitForSelector('.shelf')
    }
    const readSample = async id => {
      await page.click(`.shelf-sample[href*="sample=${id}"]`)
      await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
      check(await page.evaluate(() => window.__store.getState().session.status === 'local' && !window.__store.getState().showLogin), 'sample opens without signing in: ' + id)
    }
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(base + '?lang=zh-CN', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.shelf-sample')
    check((await page.$$('.shelf-sample')).length === 2, 'fresh guest sees both samples')
    await readSample(order[0]); await shelf()
    check((await page.$$('.shelf-book-open')).length === 1 && (await page.$$('.shelf-sample')).length === 1, 'opened book and remaining sample each appear once')
    check(!!await page.$(`.shelf-sample[href*="sample=${order[1]}"]`), 'the other sample stays available')
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.shelf-sample')
    check((await page.$$('.shelf-book-open')).length === 1, 'reload retains the opened book and other sample')
    await page.select('.shelf-language-control select', 'en')
    await page.waitForFunction(() => document.querySelector('#shelf-samples-title')?.textContent === 'More sample books')
    for (const width of [390, 320]) {
      await page.setViewport({ width, height: 844 })
      check(await page.$eval('.shelf-list', e => e.scrollWidth <= e.clientWidth), 'remaining sample fits ' + width + 'px')
    }
    const search = '.shelf-search input'
    await page.type(search, order[1] === 'alice' ? 'Alice' : '智人')
    check((await page.$$('.shelf-sample')).length === 1, 'search can find the unopened sample')
    await page.type(search, ' no-match')
    check((await page.$$('.shelf-sample')).length === 0, 'unmatched samples respect the search')
    await page.click('.shelf-search button')
    await readSample(order[1]); await shelf()
    check((await page.$$('.shelf-book-open')).length === 2 && !await page.$('.shelf-sample'), 'both opened books stay on shelf with no duplicate sample cards')
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.shelf-book-open')
    check((await page.$$('.shelf-book-open')).length === 2, 'both books survive another reload')
    const ids = await page.evaluate(() => window.__store.getState().library.map(b => b.id).sort())
    await page.click('.shelf-book-open'); await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 }); await shelf()
    assert.deepEqual(await page.evaluate(() => window.__store.getState().library.map(b => b.id).sort()), ids)
    check(true, 'reopening reuses the saved book without duplicates')
    check(writes.length === 0, 'no cloud writes or paid requests')
    check(errors.length === 0, 'no browser errors: ' + errors.join('; '))
    await context.close()
  }
} finally { await browser.close() }
