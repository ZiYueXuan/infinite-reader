// Synthetic EPUB/account only. All API traffic is intercepted; no paid generation.
import assert from 'node:assert/strict'
import JSZip from 'jszip'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const zip = new JSZip(), id = 'slides-fixture'
zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
zip.file('book.opf', '<package version="3.0"><metadata><title>阅读中的发现</title><language>zh</language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>')
zip.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#prologue">序 章</a></li><li><a href="chapter.xhtml#one">第一章 阅读与发现</a><ol><li><a href="chapter.xhtml#section">第一节 为什么阅读</a></li></ol></li><li><a href="chapter.xhtml#two">第二章 思考与表达</a></li></ol></nav></body></html>')
zip.file('chapter.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="prologue">序 章</h1><p>每个故事，都有一个开始。</p><h1 id="one">第一章 阅读与发现</h1>${'<p>在阅读中遇见新的世界，在思考中发现自己的想法。</p>'.repeat(30)}<h2 id="section">第一节 为什么阅读</h2><p>不同的视角带来不同的理解。</p><h1 id="two">第二章 思考与表达</h1>${'<p>用文字记录值得留下的思考。</p>'.repeat(20)}</body></html>`)
const epub = await zip.generateAsync({ type: 'nodebuffer' })
const slides = [
 { layout: 'overview', title: '阅读，让世界变得辽阔', takeaway: '从理解文字，到形成自己的见解。', items: [{ heading: '看见更大的世界', text: '书籍让我们接触不同经历，理解自己的经验之外还有更多可能。' }, { heading: '留下思考的痕迹', text: '提问、划线和记录，把短暂的感受变成可以再次回顾的想法。' }] },
 { layout: 'timeline', title: '让阅读成为一个完整的过程', takeaway: '理解、联系与表达，构成逐步深入的阅读。', items: [{ heading: '理解', text: '读懂作者所要表达的核心观点。' }, { heading: '联系', text: '将观点与自身经验以及其他知识联系起来。' }, { heading: '表达', text: '用自己的语言重新整理，并回到原文验证。' }] },
 { layout: 'comparison', title: '信息与理解之间', takeaway: '阅读的价值，也在于我们如何回应。', items: [{ heading: '获取信息', text: '认识新的概念，了解事件与背景。' }, { heading: '形成理解', text: '辨别观点与证据，构建自己的解释。' }] },
]
const result = { title: '序 章', slides, generatedAt: Date.now(), operationId: 'fixture' }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
 args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 950 } })
try {
 const page = await browser.newPage(), errors = []
 page.setDefaultTimeout(90000); page.on('pageerror', e => errors.push(e.message))
 let posts = 0, status = 'missing'
 await page.setRequestInterception(true)
 page.on('request', req => {
  const url = new URL(req.url()), path = url.pathname
  const json = body => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  if (path.startsWith('/api/')) {
   if (path === '/api/auth/me') return void json({ user: { id: 'fixture', email: 'fixture@example.test', name: 'Reader', avatar_url: null } })
   if (path === '/api/books') return void json({ books: [{ id, title: '阅读中的发现', author: 'Infinite Reader', language: 'zh', filename: 'fixture.epub', sizeBytes: epub.length, hasCover: false, status: 'ready', chapterCount: 1, chunkCount: 0, indexedChunks: 0, progress: null, createdAt: Date.now() }] })
   if (path.endsWith('/file')) return void req.respond({ status: 200, contentType: 'application/epub+zip', body: epub })
   if (path.endsWith('/annotations')) return void json({ annotations: [] })
   if (path.endsWith('/notes')) return void json({ notes: [] })
   if (path.endsWith('/atlas')) return void json({ maps: [], cursor: null })
   if (path.endsWith('/mindmaps')) return void json({ readyTargets: [], pending: false })
   if (path.endsWith('/slides-index')) return void json({ readyTargets: status === 'ready' ? ['chapter.xhtml#prologue'] : [] })
   if (path.endsWith('/slides')) {
    if (req.method() === 'POST') { assert.equal(JSON.parse(req.postData()).target, 'chapter.xhtml#prologue'); posts++; status = 'running' }
    return void json({ status, ...(status === 'ready' ? { result } : { completed: 0, total: 1 }) })
   }
   return void json({ ok: true })
  }
  if (url.hostname === 'static.cloudflareinsights.com') return void req.abort()
  void req.continue()
 })
 const ready = () => page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading)
 await page.goto(`${process.env.READER_URL || 'http://127.0.0.1:5177'}/book/${id}?lang=zh-CN`, { waitUntil: 'domcontentloaded' }); await ready()
 await page.evaluate(() => window.__store.getState().setPanel('toc'))
 await page.waitForSelector('.toc-slides')
 assert.equal((await page.$$('.toc-slides')).length, 3, 'prologue and numbered chapter buttons only')
 assert.equal((await page.$$('.toc-mindmap:not(.toc-slides)')).length, 4)
 assert.ok(await page.$eval('.toc-slides', el => el.getAttribute('aria-label').includes('序 章')))
 await page.click('.toc-slides'); await page.waitForSelector('.slides-status progress')
 assert.equal(posts, 1)
 await page.click('[aria-label="关闭幻灯片"]'); status = 'ready'
 await page.click('.toc-slides'); await page.waitForSelector('.chapter-slide')
 assert.equal(posts, 1, 'returning to a saved deck does not generate again')
 const before = await page.evaluate(() => window.__store.getState().turned)
 await page.focus('.chapter-slide'); await page.keyboard.press('ArrowRight')
 await page.waitForSelector('.layout-timeline'); assert.equal(await page.evaluate(() => window.__store.getState().turned), before, 'slides keys do not turn the book')
 await page.keyboard.press('End'); await page.waitForSelector('.layout-comparison')
 await page.keyboard.press('Home'); await page.waitForSelector('.layout-overview')
 await page.screenshot({ path: '/tmp/chapter-slides-desktop.png' })
 // Chromium in this headless environment leaves even a bare page's native
 // fullscreen request pending. Exercise the UI/event wiring with a controlled API.
 await page.evaluate(() => {
  let full = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full })
  document.documentElement.requestFullscreen = async () => { full = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')) }
  document.exitFullscreen = async () => { full = null; document.dispatchEvent(new Event('fullscreenchange')) }
 })
 await page.click('[aria-label="全屏演示"]'); await page.waitForFunction(() => !!document.fullscreenElement)
 await page.click('[aria-label="退出全屏"]'); await page.waitForFunction(() => !document.fullscreenElement)
 await page.setViewport({ width: 390, height: 844 }); await page.screenshot({ path: '/tmp/chapter-slides-mobile.png' })
 assert.ok(await page.$eval('.chapter-slide', el => el.scrollWidth <= el.clientWidth + 1))
 await page.click('[aria-label="下一张幻灯片"]'); await page.waitForSelector('.layout-timeline')
 await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.slides-dialog'))
 await page.click('.toc-slides'); await page.waitForSelector('.chapter-slide'); assert.equal(posts, 1)
 // AI text must remain text, even when it resembles HTML.
 result.slides[0].items[0].text = '<img src=x onerror="window.slideInjection=true">'
 await page.click('[aria-label="关闭幻灯片"]'); await page.click('.toc-slides'); await page.waitForSelector('.chapter-slide')
 assert.equal(await page.$('.chapter-slide img'), null)
 assert.equal(await page.evaluate(() => window.slideInjection), undefined)
 assert.deepEqual(errors, [])
 console.log('PASS chapter-only buttons, background completion, saved reuse, keyboard isolation, fullscreen, mobile, safe text')
} finally { await browser.close() }
