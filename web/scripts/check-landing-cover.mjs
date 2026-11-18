import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const base = process.env.LANDING_URL || 'http://127.0.0.1:5196'
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] })
try {
  for (const [lang, width, height] of [['zh-CN', 1440, 900], ['en', 390, 844]]) {
    const page = await browser.newPage(), errors = [], api = [], pending = []
    page.setDefaultTimeout(60000)
    await page.setViewport({ width, height })
    page.on('pageerror', error => errors.push(error.message))
    await page.evaluateOnNewDocument(() => {
      window.coverUploads = []
      for (const type of [WebGLRenderingContext, WebGL2RenderingContext]) {
        for (const method of ['texImage2D', 'texSubImage2D']) {
          const original = type.prototype[method]
          type.prototype[method] = function (...args) {
            for (const arg of args) if (arg instanceof HTMLImageElement) window.coverUploads.push(arg.src)
            return original.apply(this, args)
          }
        }
      }
    })
    await page.setRequestInterception(true)
    let hold = true
    page.on('request', request => {
      if (request.url().includes('/api/')) api.push(request.url())
      if (hold && /landingBookScene.*\.(js|ts)(\?|$)/.test(request.url())) pending.push(request)
      else void request.continue()
    })
    await page.goto(`${base}/?lang=${lang}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('.book-poster img')?.naturalWidth === 1024)
    const cover = await page.$eval('.book-poster img', image => image.src)
    await page.evaluate(() => {
      const story = document.querySelector('.book-story'), root = document.querySelector('.landing')
      root.scrollTo({ top: story.getBoundingClientRect().top + root.scrollTop, behavior: 'instant' })
    })
    assert.equal(await page.$('.book-story[data-ready]'), null)
    await page.screenshot({ path: `/tmp/cover-loading-${lang}.png` })
    hold = false
    await Promise.all(pending.map(request => request.continue()))
    await page.waitForSelector('.book-story[data-ready] canvas')
    assert.equal(await page.$('.book-poster'), null)
    assert.ok(await page.evaluate(cover => window.coverUploads.includes(cover), cover), '3D uploads the exact poster image')
    await page.screenshot({ path: `/tmp/cover-ready-${lang}.png` })
    await page.evaluate(() => {
      const canvas = document.querySelector('.book-scene canvas')
      canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
    })
    await page.waitForSelector('.book-story[data-static] .book-poster img')
    assert.equal(await page.$eval('.book-poster img', image => image.src), cover)
    assert.equal(await page.$$eval('.book-story-copy article', items => items.length), 10)
    await page.screenshot({ path: `/tmp/cover-fallback-${lang}.png` })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.reload({ waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('.book-poster img', image => image.src), cover)
    assert.equal(await page.$('.book-scene canvas'), null)
    assert.deepEqual(errors, [])
    assert.deepEqual(api, [])
    console.log(`PASS ${lang} ${width}px: loading, 3D texture, context loss and reduced motion share one cover; no errors or API calls`)
    await page.close()
  }
} finally { await browser.close() }
