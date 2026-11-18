// Local sample only. Exercise compact iPad desktop-site identity, touch reading and viewport changes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true })
const base = process.env.READER_ORIGIN || 'http://127.0.0.1:5198'
const output = process.env.SCREENSHOT_DIR || '/tmp/infinite-reader-ipad-mini'
await mkdir(output, { recursive: true })
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
const errors = [], api = []
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
const ready = page => page.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading, { timeout: 120000 })
const position = page => page.evaluate(() => { const r = __reader, p = r.pagination.pages[r.visiblePages.right]; return { chapter: p.chapter, start: p.start, end: p.end } })
const open = async (ua, width, height, screenWidth, screenHeight, touch = true) => {
  const page = await browser.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()) })
  await page.setUserAgent(ua)
  const cdp = await page.createCDPSession()
  const viewport = async (width, height, screenWidth, screenHeight) => {
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: false, hasTouch: touch })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth, screenHeight, deviceScaleFactor: 2, mobile: false })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
  }
  await viewport(width, height, screenWidth, screenHeight)
  await page.goto(`${base}/?sample=zh&lang=zh-CN`); await ready(page)
  return { page, cdp, viewport }
}
try {
  const { page, cdp, viewport } = await open(mac, 744, 1040, 744, 1133)
  check(await page.evaluate(() => __reader.phone && __reader.visiblePages.left === -1 && __reader.pagination.config.pageW === innerWidth && __reader.pagination.config.pageH === innerHeight), 'desktop-site iPad mini fills the viewport with one page')
  check(await page.evaluate(() => !__reader.pagination.pages.some(p => p.special === 'blank')), 'compact iPad has no double-page padding')
  const jump = async index => {
    await page.evaluate(index => __reader.goToLeaf(index), index)
    await page.waitForFunction(index => !__reader.book.busy && !!document.querySelector(`.text-layer.interactive .w[data-p="${index}"]`), {}, index)
  }
  await jump(2)
  await page.screenshot({ path: `${output}/portrait.png` })
  const touch = (type, x, y = 450) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: /End|Cancel/.test(type) ? [] : [{ x, y, id: 1 }] })
  await touch('touchStart', 700)
  check(await page.evaluate(() => __reader.visiblePages.right === 2 && !__reader.book.hasHeldLeaf), 'pressing down leaves the current page unchanged')
  for (let x = 680; x >= 420; x -= 20) await touch('touchMove', x)
  check(await page.evaluate(() => __reader.book.hasHeldLeaf && __reader.book.flyers[0].phi > 0), 'finger drag holds the same rolling page curl')
  await page.screenshot({ path: `${output}/curl.png` })
  await touch('touchEnd')
  await page.waitForFunction(() => __reader.visiblePages.right === 3 && !__reader.book.busy)
  check(true, 'a swipe advances exactly one iPad page')
  await page.click('.phone-folio')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.phone-bottom')).transform === 'none')
  await page.click('.phone-bottom nav button:first-child')
  await page.waitForSelector('.drawer', { visible: true })
  check(await page.$eval('.drawer', e => getComputedStyle(e).color === 'rgb(41, 54, 47)' && getComputedStyle(e).backgroundColor === 'rgb(245, 243, 235)'), 'contents uses readable dark text on light paper')
  await page.screenshot({ path: `${output}/contents.png` })
  await page.evaluate(() => __store.getState().setPanel('none'))
  await page.click('.phone-bottom nav button:last-child')
  await page.waitForSelector('.phone-settings', { visible: true })
  await page.click('.phone-type-size button:last-child')
  await page.waitForFunction(() => __reader.pagination.config.fontSize === 21)
  check(true, 'iPad text size uses the shared reading controls')
  await page.click('.phone-top button:last-child')
  await jump(3)
  const before = await position(page)
  await viewport(1133, 660, 1133, 744)
  await page.waitForFunction(() => __reader.pagination.config.pageW === 1133 && __reader.pagination.config.pageH === 660)
  const after = await position(page)
  check(after.chapter === before.chapter && after.start <= before.start && after.end >= before.start, 'rotation keeps the same source passage in a single page')
  await page.screenshot({ path: `${output}/landscape.png` })
  await viewport(507, 1040, 744, 1133)
  await page.waitForFunction(() => __reader.pagination.config.pageW === 507)
  check(await page.evaluate(() => __reader.phone && document.documentElement.scrollWidth === innerWidth), 'split view fits without horizontal overflow')
  await page.evaluate(() => __store.getState().saveReadingProgress())
  const saved = await position(page)
  await page.reload(); await ready(page)
  const restored = await position(page)
  check(await page.evaluate(() => __reader.phone) && restored.chapter === saved.chapter && restored.start === saved.start, 'split-view reload retains single-page mode and source progress')
  await page.close()
  for (const profile of [
    { ua: ipad, w: 768, h: 940, sw: 768, sh: 1024, touch: true, single: true, name: 'older iPad mini mobile user agent' },
    { ua: mac, w: 756, h: 1060, sw: 756, sh: 1158, touch: true, single: true, name: 'compact iPad desktop user agent' },
    { ua: mac, w: 600, h: 900, sw: 820, sh: 1180, touch: true, single: false, name: 'larger iPad in split view' },
    { ua: mac, w: 744, h: 1040, sw: 744, sh: 1133, touch: false, single: false, name: 'Mac without a touchscreen' },
  ]) {
    const { page } = await open(profile.ua, profile.w, profile.h, profile.sw, profile.sh, profile.touch)
    check(await page.evaluate(() => __reader.phone) === profile.single, `${profile.name} selects the expected layout`)
    await page.close()
  }
  check(api.length === 0, 'isolated iPad checks never call production APIs')
  check(errors.length === 0, `no runtime errors: ${errors.join('; ')}`)
} finally { await browser.close() }
