// VITE_BACKEND=api; all service responses are fixtures, with no real uploads or AI calls.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage(), errors = [], calls = []
page.on('pageerror', e => errors.push(e.message))
const source = { kind: 'opf', path: 'OEBPS/content.opf', field: 'dc:title', index: 0 }
const value = text => ({ value: text, source })
const b = { schemaVersion: 1, extractorVersion: 1, format: 'epub', extractedAt: Date.now(), titles: [value('小王子：双语版')],
  contributors: [{ name: '圣埃克苏佩里', roles: ['aut'], source }, { name: '译者甲', roles: ['trl'], source }],
  publishers: [value('某出版社')], dates: [{ ...value('2003-08'), type: 'publication' }, { ...value('2026-10-30'), type: 'dcterms:modified' }],
  languages: [value('zh-CN')], editions: [value('第二版')], descriptions: [value('<script>window.bad=1</script>这是一段简介。')], subjects: [value('文学')], rights: [value('版权所有')],
  identifiers: [{ raw: 'ISBN: 702004249X', normalized: '9787020042494', scheme: 'ISBN', valid: true, relation: 'source', source },
    { raw: '9787505715661', normalized: null, scheme: 'ISBN', valid: false, relation: 'unknown', source: { ...source, kind: 'copyright-page' } }],
  warnings: ['invalid_isbn'], raw: [{ field: 'dc:title', value: '小王子：双语版', attributes: {}, source }] }
const user = { id: 'info-user', email: 'info@example.com', name: 'Reader', avatar_url: null }
const book = { id: 'metadata-test', title: '我的书架标题', author: '书架作者', language: 'zh-CN', filename: '小王子.epub', sizeBytes: 2097152,
  hasCover: false, status: 'ready', chapterCount: 3, chunkCount: 10, indexedChunks: 10, progress: null, createdAt: Date.now() }
let mode = 'ready', posted = false, reads = 0
await page.setRequestInterception(true)
page.on('request', request => {
  const path = new URL(request.url()).pathname
  if (!path.startsWith('/api/')) return void request.continue()
  calls.push({ path, method: request.method() })
  const json = (body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (path === '/api/auth/me') return void json({ user })
  if (path === '/api/auth/providers') return void json({ email: true, google: true })
  if (path === '/api/books') return void json({ books: [book] })
  if (path.endsWith('/metadata')) {
    if (mode === 'error') return void json({ error: { code: 'unavailable', message: 'Unavailable' } }, 503)
    if (request.method() === 'POST') { posted = true; reads = 0; return void json({ status: 'pending' }, 202) }
    reads++
    const status = mode === 'ready' || (mode === 'empty' && posted && reads >= 2) ? 'ready' : mode === 'empty' && !posted ? 'not_extracted' : mode === 'failed' ? 'failed' : 'pending'
    return void json({ status, bibliography: status === 'ready' ? b : null, attemptedAt: ['pending', 'failed'].includes(status) ? Date.now() : null, error: status === 'failed' ? 'extraction_failed' : null })
  }
  void json({ ok: true })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS', label) }
const open = async () => { await page.click('.shelf-book-more'); await page.click('.shelf-book-menu-info'); await page.waitForSelector('.book-info-dialog[open]') }
const waitText = text => page.waitForFunction(t => document.querySelector('.book-info-dialog')?.textContent.includes(t), {}, text)
const clickText = text => page.$$eval('.book-info-dialog button', (els, t) => els.find(e => e.textContent === t).click(), text)
const close = async () => { await page.click('[aria-label="关闭书籍信息"]'); await page.waitForFunction(() => !document.querySelector('.book-info-dialog')) }
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5175/shelf', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.shelf-book-more')
  await page.click('.shelf-book-more')
  check(await page.$eval('.shelf-book-menu-info', e => e === document.activeElement), 'first menu action receives focus')
  await page.keyboard.press('ArrowDown')
  check(await page.$eval('.shelf-book-menu-delete', e => e === document.activeElement), 'arrow keys reach the existing delete action')
  await page.keyboard.press('Home'); await page.keyboard.press('Enter')
  await waitText('ISBN 校验未通过')
  const text = await page.$eval('.book-info-dialog', e => e.textContent)
  check(['译者甲', '某出版社', '第二版', '9787020042494', 'ISBN: 702004249X', '来源出版物', '版权页', '出版日期', '文件修改日期'].every(s => text.includes(s)), 'publication fields, provenance, identifiers and date types render')
  check(!await page.evaluate(() => window.bad), 'metadata is rendered as text, not HTML')
  check(!calls.some(c => c.method === 'POST' || c.path.endsWith('/file')), 'viewing saved metadata neither extracts nor opens the book')
  await page.click('.book-info-raw summary'); await page.waitForSelector('.book-info-raw pre')
  check((await page.$eval('.book-info-raw pre', e => e.textContent)).includes('OEBPS/content.opf'), 'raw source records are available on demand')
  await page.click('.book-info-raw summary')
  await page.$eval('.book-info-content', e => { e.scrollTop = 0 })
  await fs.mkdir('/tmp/book-info-check', { recursive: true })
  await page.screenshot({ path: '/tmp/book-info-check/desktop.png' })
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.book-info-dialog'))
  check(await page.$eval('.shelf-book-more', e => e === document.activeElement), 'Escape restores focus to the book menu button')

  mode = 'empty'; posted = false
  await open(); await waitText('提取出版信息'); await clickText('提取出版信息'); await waitText('正在后台提取')
  await waitText('出版信息已保存')
  check(calls.filter(c => c.method === 'POST').length === 1, 'one explicit extraction is followed only by status reads')
  await close()

  mode = 'pending'
  await open(); await waitText('正在后台提取'); await close()
  const n = calls.length; await sleep(2300)
  check(calls.length === n, 'closing the dialog cancels pending polling')
  mode = 'error'; await open(); await waitText('暂时无法读取')
  mode = 'ready'; await clickText('重新读取'); await waitText('出版信息已保存'); await close()
  mode = 'failed'; await open(); await waitText('上次提取未完成'); const posts = calls.filter(c => c.method === 'POST').length
  await clickText('重试提取'); await waitText('重试间隔')
  check(calls.filter(c => c.method === 'POST').length === posts, 'retry cooldown does not create misleading extraction requests')
  await close()

  mode = 'ready'; await page.setViewport({ width: 390, height: 740 }); await open(); await waitText('出版信息已保存')
  check(await page.$eval('.book-info-dialog', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.scrollWidth <= e.clientWidth }), 'narrow-screen dialog stays within the viewport')
  await page.screenshot({ path: '/tmp/book-info-check/mobile.png' })
  await page.evaluate(() => window.__store.setState({ session: { status: 'anon' }, library: [] }))
  await page.waitForFunction(() => !document.querySelector('.book-info-dialog'))
  check(!errors.length, `no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
