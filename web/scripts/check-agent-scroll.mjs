// API-mode frontend, fixture book and mocked services. No uploads or AI calls.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
const epub = await fs.readFile(new URL('../public/samples/zh-sample.epub', import.meta.url))
const user = { id: 'scroll-user', email: 'dock@example.com', name: 'Reader', avatar_url: null }
const book = { id: 'scroll-book', title: 'A quiet reading desk', author: 'Reader', language: 'zh-CN', filename: 'sample.epub', sizeBytes: epub.length,
  status: 'ready', chapterCount: 3, chunkCount: 10, indexedChunks: 10, progress: null, createdAt: Date.now() }
let historyRequest, markdownRequest, imageRequest
const history = Array.from({ length: 16 }, (_, index) => ({
  id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', selection: null, citations: [],
  content: index % 2 ? `## Answer ${index}\n\n` + 'A long explanation with enough detail to wrap over several lines. '.repeat(14) : `Question ${index}`,
}))
history.at(-1).content += '\n\n![Delayed illustration](/scroll-fixture.svg)\n\nLATEST SAVED MESSAGE'
await page.evaluateOnNewDocument(() => {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (url, options) => {
    if (String(url) !== '/api/ask') return originalFetch(url, options)
    return Promise.resolve(new Response(new ReadableStream({ start(controller) { window.__chatController = controller } }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
  }
  window.__chatEvent = (type, text) => {
    window.__chatController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, text })}\n\n`))
    if (type === 'done') window.__chatController.close()
  }
})
await page.setRequestInterception(true)
page.on('request', request => {
  const path = new URL(request.url()).pathname
  if (path === '/src/ui/AnswerText.tsx') { markdownRequest = request; return }
  if (path === '/scroll-fixture.svg') { imageRequest = request; return }
  if (!path.startsWith('/api/')) return void request.continue()
  const json = body => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  if (path === '/api/auth/me') return void json({ user })
  if (path === '/api/auth/providers') return void json({ email: true, google: true })
  if (path === '/api/books') return void json({ books: [book] })
  if (path.endsWith('/file')) return void request.respond({ status: 200, contentType: 'application/epub+zip', body: epub })
  if (path.endsWith('/annotations')) return void json({ annotations: [] })
  if (path.endsWith('/notes')) return void json({ notes: [] })
  if (path.endsWith('/chat')) { historyRequest = request; return }
  void json({ ok: true })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let checks = 0
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log('PASS', label) }
const atBottom = () => page.$eval('.thread', e => e.scrollHeight - e.clientHeight - e.scrollTop <= 2)
const waitBottom = () => page.waitForFunction(() => {
  const e = document.querySelector('.thread')
  return e && e.scrollHeight > e.clientHeight && e.scrollHeight - e.clientHeight - e.scrollTop <= 2
})
const scrollUp = async () => {
  await page.hover('.thread'); await page.mouse.wheel({ deltaY: -100000 })
  await page.waitForFunction(() => document.querySelector('.thread').scrollTop < 5)
}
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5175/?lang=en', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.shelf-book-open'); await page.click('.shelf-book-open')
  await page.waitForFunction(() => window.__store.getState().current && !window.__store.getState().loading, { timeout: 60000 })
  await page.click('.agent-launcher')
  await page.waitForSelector('.ask-status')
  check((await page.$eval('.ask-status', e => e.textContent)).includes('Loading'), 'panel can open before saved history arrives')
  assert.ok(historyRequest)
  await historyRequest.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: history, pending: null }) })
  await page.waitForFunction(() => document.querySelectorAll('.thread .msg').length === 16)
  await waitBottom(); check(await atBottom(), 'late history arrives at the bottom')
  assert.ok(markdownRequest)
  await markdownRequest.continue()
  await page.waitForSelector('.answer-markdown h2')
  await waitBottom(); check(await atBottom(), 'lazy Markdown layout keeps the latest message in view')
  await page.waitForSelector('.answer-markdown img')
  for (let i = 0; !imageRequest && i < 100; i++) await sleep(50)
  assert.ok(imageRequest)
  await imageRequest.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="900"><rect width="480" height="900" fill="#55664a"/></svg>' })
  await page.waitForFunction(() => document.querySelector('.answer-markdown img').naturalHeight === 900)
  await waitBottom(); check(await atBottom(), 'late image sizing preserves bottom position')
  await scrollUp(); await sleep(350)
  check(!await atBottom(), 'reader can scroll up through saved history')
  await page.click('[aria-label="Close Infinite window"]'); await page.click('.agent-launcher')
  await waitBottom(); check(await atBottom(), 'reopening a cached conversation resets to the latest message')
  await page.click('[aria-label="Expand Infinite"]'); await waitBottom()
  check(await atBottom(), 'expanded window stays at the latest message')
  await page.click('[aria-label="Restore Infinite size"]'); await waitBottom()
  check(await atBottom(), 'restoring window size stays at the latest message')
  await scrollUp()
  await page.type('#agent-question', 'Continue the explanation')
  await page.click('[aria-label="Send question"]')
  await page.waitForFunction(() => !!window.__chatController)
  await page.evaluate(() => window.__chatEvent('delta', 'STREAM ONE\n\n' + 'Streaming response. '.repeat(160)))
  await page.waitForFunction(() => document.querySelector('.thread').textContent.includes('STREAM ONE'))
  await waitBottom(); check(await atBottom(), 'sending a question resumes following the new reply')
  await scrollUp()
  await page.evaluate(() => window.__chatEvent('delta', '\n\nSTREAM TWO\n\n' + 'More response. '.repeat(160)))
  await page.waitForFunction(() => document.querySelector('.thread').textContent.includes('STREAM TWO'))
  await sleep(350)
  check(await page.$eval('.thread', e => e.scrollTop < 5), 'streaming does not pull a reader away from older messages')
  await page.click('[aria-label="Close Infinite window"]')
  await page.evaluate(() => { window.__chatEvent('delta', '\n\nLATEST WHILE CLOSED'); window.__chatEvent('done') })
  await page.click('.agent-launcher')
  await page.waitForFunction(() => document.querySelector('.thread').textContent.includes('LATEST WHILE CLOSED'))
  await waitBottom(); check(await atBottom(), 'opening after a background reply lands at the latest content')
  check(!errors.length, 'no browser runtime errors: ' + errors.join('; '))
  console.log(`${checks} assertions passed`)
} finally { await browser.close() }
