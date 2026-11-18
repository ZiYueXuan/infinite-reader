// Run Vite with VITE_BACKEND=api. All API calls use fixtures; no paid/provider requests.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage(), calls = [], errors = []
const user = { id: 'cost-user', email: 'cost@example.com', name: null, avatar_url: null, can_view_cost_debug: true }
let fail = false, hold = false, held = []
page.on('pageerror', e => errors.push(e.message))
await page.evaluateOnNewDocument(() => {
  const timeout = window.setTimeout.bind(window)
  window.setTimeout = (fn, delay, ...args) => timeout(fn, delay === 15000 ? 180 : delay, ...args)
})
const fixture = url => {
  const now = Date.now(), since = Number(url.searchParams.get('since'))
  const item = { id: 'ai-call', operationId: 'ask-operation', category: 'ask', label: 'AI 问答', bookId: 'b', bookTitle: 'Test book', startedAt: now, status: 'succeeded', model: 'deepseek-flash', usd: .00012, lowUsd: .00006, basis: 'estimated', reason: '峰时区间测试', parts: [{ label: '输出', quantity: 100, unit: 'tokens', usd: .00012 }] }
  return { since, asOf: now, pricingVersion: '2026-10-29', currency: 'USD', truncated: false, totalUsd: .00012, lowUsd: .00006, unknown: 1, estimated: 1, count: 2, groups: [{ label: 'AI 问答', usd: .00012, count: 2, unknown: 1 }], items: [item, { ...item, id: 'pending', usd: null, lowUsd: null, status: 'started', basis: 'unavailable', parts: [], reason: '等待用量' }], storage: { bytes: 2000000, books: 1, usdPerMonth: .00003 }, sources: [{ label: 'DeepSeek', url: 'https://api-docs.deepseek.com/quick_start/pricing/' }], exclusions: ['CPU、Vectorize 未计量。不是实际账单。'] }
}
await page.setRequestInterception(true)
page.on('request', request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) return void request.continue()
  const json = (body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (url.pathname === '/api/auth/me') return void json({ user })
  if (url.pathname === '/api/auth/providers') return void json({ email: true, google: true })
  if (url.pathname === '/api/books') return void json({ books: [] })
  if (url.pathname === '/api/costs') {
    calls.push(url)
    if (hold) { held.push(() => json(fixture(url))); return }
    return void (fail ? json({ error: { code: 'test_error', message: 'Test refresh unavailable' } }, 503) : json(fixture(url)))
  }
  void json({ ok: true })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS', label) }
const openCosts = async () => {
  await page.click('.account .chip')
  await page.$$eval('.account .menu button', els => els.find(el => el.textContent === '费用 · DEBUG').click())
}
const button = async text => { await page.$$eval('.cost-debug button', (els, text) => els.find(el => el.textContent === text).click(), text) }
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5174/shelf', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.shelf-controls .account .chip')
  await sleep(300)
  check(!await page.$('.cost-debug') && calls.length === 0, 'shelf initially hides the whole debug window and makes no cost requests')
  await openCosts()
  await page.waitForSelector('.cost-item')
  check(await page.$eval('.cost-debug', e => e.getBoundingClientRect().top >= document.querySelector('.shelf-controls').getBoundingClientRect().bottom), 'shelf costs open below the account capsule')
  check((await page.$eval('.cost-total strong', e => e.textContent)) === '$0.000060–$0.000120', 'tiny costs and uncertainty range stay readable')
  check((await page.$$eval('.cost-item summary', els => els.map(e => e.textContent).join(' '))).includes('待计量'), 'missing usage is never shown as zero')
  await page.click('.cost-item summary')
  check((await page.$eval('.cost-item[open]', e => e.textContent)).includes('100 tokens'), 'an operation expands to usage and cost components')
  await sleep(450)
  check(calls.length >= 2, 'expanded panel polls')
  await page.click('.cost-heading')
  await sleep(100)
  const collapsedCount = calls.length
  await sleep(500)
  check(calls.length === collapsedCount, 'collapsed panel stops polling')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.shelf-controls .account .chip')
  check(!await page.$('.cost-debug'), 'reload keeps costs hidden until explicitly opened')
  await openCosts()
  await page.waitForSelector('.cost-item')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(80)
  const hiddenCount = calls.length
  await sleep(500)
  check(calls.length === hiddenCount, 'background tab stops polling')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(250)
  check(calls.length > hiddenCount, 'returning to foreground resumes polling')
  const originalSince = Number(calls.at(-1).searchParams.get('since'))
  await button('重置观察')
  await sleep(250)
  check(Number(calls.at(-1).searchParams.get('since')) > originalSince, 'reset changes observation start')
  await button('今天')
  await sleep(250)
  const midnight = await page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })
  check(Number(calls.at(-1).searchParams.get('since')) === midnight, 'today uses local midnight')
  fail = true
  await button('刷新')
  await page.waitForSelector('.cost-debug [role=alert]')
  check((await page.$eval('.cost-total strong', e => e.textContent)).includes('$0.000120'), 'failed refresh preserves labeled last result')
  fail = false
  await button('刷新')
  await page.waitForSelector('.cost-debug [role=alert]', { hidden: true })
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => { if (blob.type === 'application/json') window.__costExport = blob.text(); return original(blob) }
  })
  await button('导出快照')
  const exported = JSON.parse(await page.evaluate(() => window.__costExport))
  check(exported.items.length === 2 && exported.exclusions.length > 0 && exported.pricingVersion, 'export contains itemized costs, pricing and coverage')
  await fs.mkdir('/tmp/cost-debug-screenshots', { recursive: true })
  await page.screenshot({ path: '/tmp/cost-debug-screenshots/desktop.png' })
  await page.setViewport({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/cost-debug-screenshots/mobile.png' })
  check(await page.$eval('.cost-debug', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }), 'panel fits mobile viewport')
  const observedSince = Number(calls.at(-1).searchParams.get('since'))
  await page.evaluate(() => window.__store.setState({ current: { meta: { id: 'cost-book', title: 'Test book' }, parsed: { chapters: [], toc: [] } } }))
  await page.waitForSelector('.cost-debug', { hidden: true })
  await sleep(100)
  const readingHiddenCount = calls.length
  await sleep(350)
  check(calls.length === readingHiddenCount, 'reading page hides the launcher and pauses polling')
  await openCosts()
  await page.waitForSelector('.cost-reading .cost-item')
  check(Number(calls.at(-1).searchParams.get('since')) === observedSince, 'account entry preserves the observation period')
  check(await page.$eval('.cost-reading', e => { const r=e.getBoundingClientRect(); return r.top >= 50 && r.right <= innerWidth && r.bottom <= innerHeight }), 'reading costs open below the capsule and fit mobile viewport')
  await page.click('.cost-heading')
  await page.waitForSelector('.cost-debug', { hidden: true })
  check(await page.$eval('.account .chip', e => e === document.activeElement), 'closing hides the whole reader panel and restores capsule focus')
  await page.evaluate(() => window.__store.setState({ current: null }))
  await page.waitForSelector('.shelf-controls .account .chip')
  check(!await page.$('.cost-debug'), 'returning to shelf does not restore a floating launcher')
  await openCosts()
  await page.waitForSelector('.cost-item')
  hold = true
  await button('刷新')
  await sleep(100)
  await page.evaluate(() => window.__store.setState({ session: { status: 'user', user: { id: 'other-user', email: 'other@example.com', name: null, avatar_url: null, can_view_cost_debug: true } } }))
  await sleep(150)
  check(!await page.$('.cost-debug'), 'switching accounts closes the previous cost panel')
  await openCosts()
  check((await page.$eval('.cost-total strong', e => e.textContent)).includes('读取中'), 'switching accounts clears previous cost data immediately')
  await page.evaluate(() => window.__store.setState({ session: { status: 'local' } }))
  for (const resolve of held) await resolve().catch(() => {})
  await sleep(300)
  const offlineCount = calls.length
  await sleep(400)
  check(calls.length === offlineCount && !await page.$('.cost-debug'), 'offline mode makes no cost calls; stale responses cannot reopen panel')
  await page.evaluate(() => window.__store.setState({ session: { status: 'user', user: { id: 'ordinary-user', email: 'cost@example.com', name: null, avatar_url: null, can_view_cost_debug: false } } }))
  await page.waitForSelector('.account .chip')
  await page.click('.account .chip')
  check(!await page.$$eval('.account .menu button', buttons => buttons.some(button => button.textContent.includes('DEBUG'))), 'the account menu reads the server capability')
  check(calls.length === offlineCount, 'a session without access makes no cost requests')
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
