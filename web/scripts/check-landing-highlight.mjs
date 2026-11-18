import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const base = process.env.LANDING_URL || 'http://127.0.0.1:5196'
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] })
try {
  for (const [lang, width, height] of [['zh-CN', 1440, 900], ['en', 1440, 900], ['zh-CN', 390, 844], ['en', 390, 844]]) {
    const page = await browser.newPage(), errors = [], api = []
    page.setDefaultTimeout(60000)
    await page.setViewport({ width, height })
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.url().includes('/api/')) api.push(request.url()) })
    await page.goto(`${base}/?lang=${lang}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.book-story[data-ready] canvas')
    const progress = async value => {
      await page.evaluate(value => {
        const story = document.querySelector('.book-story'), root = document.querySelector('.landing')
        root.scrollTo({ top: story.getBoundingClientRect().top + root.scrollTop + value * (story.offsetHeight - root.clientHeight), behavior: 'instant' })
      }, value)
      await page.waitForFunction(value => Math.abs(Number(document.querySelector('.book-story').dataset.progress) - value) < .0002, {}, value)
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    await progress(.37)
    await page.screenshot({ path: `/tmp/highlight-complete-${lang}-${width}.png` })
    // Isolate the book to compare rendered highlight pixels against the original ink,
    // independently of the card animation, chapter copy and progress indicator.
    await page.addStyleTag({ content: '.book-stage{background:#101e19!important}.book-stage::before{display:none!important}.book-stage>:not(.book-scene){visibility:hidden!important}.book-scene{opacity:1!important}.book-stage::after{display:none!important}' })
    const frame = async value => { await progress(value); return (await page.screenshot({path: `/tmp/highlight-isolated-${lang}-${width}-${value}.png`})).toString('base64') }
    const before = await frame(.30), middle = await frame(.3375), after = await frame(.37), reverse = await frame(.30)
    const result = await page.evaluate(async (before, middle, after, reverse) => {
      const pixels = async source => {
        const image = new Image(); image.src = 'data:image/png;base64,' + source; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
        return ctx.getImageData(0, 0, canvas.width, canvas.height)
      }
      const [a, b, c, d] = await Promise.all([before, middle, after, reverse].map(pixels))
      const bounds = target => {
        let x0 = a.width, y0 = a.height, x1 = -1, y1 = -1
        for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
          const i = (y * a.width + x) * 4
          if (Math.max(...[0, 1, 2].map(k => Math.abs(a.data[i + k] - target.data[i + k]))) < 8) continue
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
        }
        const brightness = []
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = (y * a.width + x) * 4
          brightness.push(Math.max(a.data[i], a.data[i + 1], a.data[i + 2]))
        }
        brightness.sort((a, b) => a - b)
        const paper = brightness[Math.floor(brightness.length * .9)]
        const ink = brightness.filter(value => value < paper - 25).length
        return { width: x1 - x0 + 1, height: y1 - y0 + 1, ink, area: (x1 - x0 + 1) * (y1 - y0 + 1) }
      }
      let difference = 0
      for (let i = 0; i < a.data.length; i++) difference += Math.abs(a.data[i] - d.data[i])
      return { middle: bounds(b), full: bounds(c), reverseDifference: difference / a.data.length }
    }, before, middle, after, reverse)
    assert.ok(result.full.width > 30 && result.full.height > 3, JSON.stringify(result))
    assert.ok(result.full.ink > 5 && result.full.ink / result.full.area > .01, 'highlight must cover printed glyphs, not blank paper: ' + JSON.stringify(result))
    assert.ok(result.middle.width / result.full.width > .4 && result.middle.width / result.full.width < .65, 'highlight grows across its sentence: ' + JSON.stringify(result))
    assert.ok(result.reverseDifference < .1, 'reverse scroll clears the mark')
    assert.deepEqual(errors, []); assert.deepEqual(api, [])
    console.log(`PASS ${lang} ${width}px: mark overlaps ink, grows with scroll and reverses; ${JSON.stringify(result)}`)
    await page.close()
  }
} finally { await browser.close() }
