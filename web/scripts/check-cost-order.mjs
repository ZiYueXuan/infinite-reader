// Fixture admin account only: all API traffic is intercepted, no private ledger reads.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const now = Date.now(), newest = now - 1000, older = now - 86400_000
const item = { operationId: 'fixture', bookId: null, bookTitle: null, status: 'succeeded', model: 'deepseek-flash', lowUsd: .001, basis: 'reported', reason: 'fixture', parts: [] }
const snapshot = { since: older - 1000, asOf: now, pricingVersion: 'fixture', currency: 'USD', truncated: false, totalUsd: .101, lowUsd: .101, unknown: 0, estimated: 0, count: 2,
  items: [{ ...item, id: 'new', category: 'chapter_slides', label: '章节幻灯片', startedAt: newest, usd: .001 }, { ...item, id: 'old', category: 'ask', label: 'AI 问答', startedAt: older, usd: .1, lowUsd: .1 }],
  groups: [{ label: '章节幻灯片', usd: .001, count: 1, unknown: 0, latestStartedAt: newest }, { label: 'AI 问答', usd: .1, count: 1, unknown: 0, latestStartedAt: older }],
  storage: { bytes: 0, books: 0, usdPerMonth: 0 }, exclusions: [], sources: [] }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 900 } })
try {
  const page = await browser.newPage(), errors = []
  await page.emulateTimezone('Asia/Shanghai')
  page.on('pageerror', e => errors.push(e.message))
  await page.setRequestInterception(true)
  page.on('request', req => {
    const path = new URL(req.url()).pathname
    if (!path.startsWith('/api/')) return void req.continue()
    const body = path === '/api/auth/me' ? { user: { id: 'fixture', email: 'cost-admin@example.test', name: 'Reader', avatar_url: null, can_view_cost_debug: true } }
      : path === '/api/books' ? { books: [] } : path === '/api/costs' ? snapshot : { ok: true }
    void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const open = async () => {
    await page.waitForSelector('.account .chip'); await page.click('.account .chip')
    await page.$$eval('.account .menu button', buttons => buttons.find(b => b.textContent.includes('DEBUG')).click())
    await page.waitForSelector('.cost-item time')
  }
  const base = process.env.READER_URL || 'http://127.0.0.1:5177'
  await page.goto(base + '/shelf?lang=zh-CN', { waitUntil: 'domcontentloaded' }); await open()
  assert.deepEqual(await page.$$eval('.cost-item time', els => els.map(e => e.dateTime)), [new Date(newest).toISOString(), new Date(older).toISOString()])
  assert.deepEqual(await page.$$eval('.cost-item summary b', els => els.map(e => e.textContent)), ['章节幻灯片', 'AI 问答'])
  assert.ok(await page.$eval('.cost-item', el => !!(el.compareDocumentPosition(document.querySelector('.cost-groups')) & Node.DOCUMENT_POSITION_FOLLOWING)))
  assert.equal(await page.$eval('.cost-groups', el => el.open), false, 'category totals are collapsed by default')
  const timestamps = await page.$$eval('.cost-item time', els => els.map(e => ({ text: e.textContent, title: e.title })))
  assert.ok(timestamps.every(e => /\d{4}\/\d{2}\/\d{2}.*\d{2}:\d{2}:\d{2}/.test(e.text)))
  assert.notEqual(timestamps[0].text.slice(0, 10), timestamps[1].text.slice(0, 10), 'cross-day operations show different dates')
  assert.ok(timestamps.every(e => e.title.includes('中国标准时间')))
  await page.screenshot({ path: '/tmp/cost-order-desktop.png' })
  await page.click('.cost-groups > summary')
  assert.deepEqual(await page.$$eval('.cost-groups time', els => els.map(e => e.dateTime)), [new Date(newest).toISOString(), new Date(older).toISOString()])
  await page.click('.cost-groups > summary')
  await page.setViewport({ width: 390, height: 844 })
  await page.$eval('.cost-content', el => { el.scrollTop = 0 })
  await page.screenshot({ path: '/tmp/cost-order-mobile.png' })
  assert.ok(await page.$eval('.cost-debug', el => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth + 1))
  await page.goto(base + '/shelf?lang=en', { waitUntil: 'domcontentloaded' }); await open()
  assert.equal(await page.$eval('.cost-order', el => el.textContent), 'Newest operation first · Local time')
  assert.ok((await page.$eval('.cost-item time', el => el.textContent)).includes(String(new Date(newest).getFullYear())))
  assert.deepEqual(errors, [])
  console.log('PASS newest-first details, full cross-day local timestamps, collapsed category totals with latest time, mobile and English')
} finally { await browser.close() }
