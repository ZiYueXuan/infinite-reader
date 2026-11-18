// Run against VITE_BACKEND=api. Hold file responses to verify feedback precedes download.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
const epub = await fs.readFile(new URL('../public/samples/zh-sample.epub', import.meta.url))
const user = { id: 'loading-user', email: 'loading@example.com', name: 'Reader', avatar_url: null }
const book = { id: 'loading-test', title: 'Test book', author: 'Test author', language: 'zh-CN', filename: 'test.epub', sizeBytes: epub.length,
  hasCover: false, status: 'ready', chapterCount: 3, chunkCount: 10, indexedChunks: 10, progress: null, createdAt: Date.now() }
let held = null, requests = 0
await page.setRequestInterception(true)
page.on('request', request => {
  const path = new URL(request.url()).pathname
  if (!path.startsWith('/api/')) return void request.continue()
  const json = (body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (path === '/api/auth/me') return void json({ user })
  if (path === '/api/auth/providers') return void json({ email: true, google: true })
  if (path === '/api/books') return void json({ books: [book] })
  if (path.endsWith('/file')) { requests++; held = request; return }
  if (path.endsWith('/annotations')) return void json({ annotations: [] })
  if (path.endsWith('/notes')) return void json({ notes: [] })
  if (path.endsWith('/chat')) return void json({ messages: [], pending: null })
  void json({ ok: true })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS', label) }
const home = async () => {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5175/shelf', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.shelf-book-open')
  held = null
}
async function clickAndHold(keyboard = false) {
  const before = requests
  if (keyboard) { await page.focus('.shelf-book-open'); await page.keyboard.press('Enter') }
  else await page.click('.shelf-book-open')
  check(await page.evaluate(() => window.__store.getState().loading?.label === 'Loading book'), 'loading is set by the click before file response')
  await page.waitForSelector('.loading', { visible: true, timeout: 1000 })
  await sleep(250)
  check(held !== null && requests === before + 1, 'file remains pending while feedback is visible')
  check(await page.$eval('.loading', e => Number(getComputedStyle(e).opacity) > 0 && e.getBoundingClientRect().width > 0), 'loading overlay is visible during download')
  return held
}
try {
  for (const status of [404, 503, 401]) {
    await home()
    const request = await clickAndHold(status === 503)
    await request.respond({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'test_error', message: 'Test download failure' } }) })
    await page.waitForFunction(() => !document.querySelector('.loading'))
    check(await page.evaluate(() => window.__store.getState().loading === null), `${status} failure clears loading`)
    if (status !== 401) await page.waitForSelector('.shelf-book-open')
    else check(await page.evaluate(() => window.__store.getState().session.status === 'anon'), 'expired login still returns to signed-out state')
  }
  await home()
  const request = await clickAndHold()
  await request.respond({ status: 200, contentType: 'application/epub+zip', body: epub })
  await page.waitForFunction(() => window.__store.getState().current?.meta.id === 'loading-test' && !window.__store.getState().loading, { timeout: 60000 })
  check(await page.evaluate(() => window.__store.getState().open), 'successful download continues through parsing to the open book')
  check(!errors.length, `no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
