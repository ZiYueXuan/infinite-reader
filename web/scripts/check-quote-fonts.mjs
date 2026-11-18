// Exercise real EPUB parsing, font switching and page textures with an isolated guest sample.
// Optional EPUB_FILE checks the reported chapter locally; no book is uploaded or AI called.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import JSZip from 'jszip'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const zip = new JSZip()
zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
zip.file('book.opf', '<package><metadata><title>Quote font check</title><language>zh</language></metadata><manifest><item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>')
let markup = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
<p>这是普通正文，应该使用所选的阅读字体。</p>
<blockquote><blockquote><tt>这是引用正文，也应该使用所选字体。<b>加粗引用。</b><i>斜体引用。</i><sup>35</sup><code>const answer = 42;</code> <kbd>Ctrl</kbd> <samp>output</samp></tt></blockquote></blockquote>
<blockquote><pre>preformatted code</pre></blockquote>
<p><tt>legacy teletype outside quotation</tt></p>
<p>这是引用结束之后的正文。</p></body></html>`
if (process.env.EPUB_FILE) {
  const original = await JSZip.loadAsync(await fs.readFile(process.env.EPUB_FILE))
  markup = await original.file('index_split_005.html').async('string')
  for (const name of ['stylesheet.css', 'page_styles.css']) if (original.file(name)) zip.file(name, await original.file(name).async('string'))
}
zip.file('chapter.xhtml', markup)
const epub = await zip.generateAsync({ type: 'nodebuffer' })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 950 } })
try {
  const page = await browser.newPage(), errors = []
  page.setDefaultTimeout(120000)
  page.on('pageerror', e => errors.push(e.message))
  await page.setRequestInterception(true)
  page.on('request', req => {
    const path = new URL(req.url()).pathname
    if (path === '/samples/zh-sample.epub') return void req.respond({ status: 200, contentType: 'application/epub+zip', body: epub })
    if (path.startsWith('/api/')) return void req.respond({ status: 401, contentType: 'application/json', body: '{"error":{"code":"unauthorized","message":"Sign in required"}}' })
    return void req.continue()
  })
  await page.goto((process.env.READER_URL || 'http://127.0.0.1:5176') + '/shelf?sample=zh&lang=zh-CN', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading)
  const original = await page.evaluate(() => JSON.stringify(window.__store.getState().current.parsed.chapters))
  assert.equal(await page.evaluate(() => window.__store.getState().quoteFont), 'wenkai', 'new and existing preferences default to literary quote font')
  for (const [mode, id] of [['wenkai','wenkai'], ['wenkai','noto-serif'], ['inherit','noto-serif'], ['inherit','noto-sans'], ['wenkai','noto-sans']]) {
    await page.evaluate(mode => window.__store.getState().setQuoteFont(mode), mode)
    await page.evaluate(id => window.__store.getState().setReaderFont(id), id)
    const result = await page.evaluate(realBook => {
      const state = window.__store.getState(), pag = window.__reader.pagination
      const blocks = state.current.parsed.chapters[0].blocks
      const quote = blocks.find(b => b.text.startsWith(realBook ? '兹所谓满蒙者' : '这是引用正文'))
      const words = pag.pages.flatMap(p => p.lines.flatMap(l => l.words))
      const within = words.filter(w => w.s >= quote.start && w.s < quote.start + quote.text.length)
      // Explicit code remains monospace. The real reported quote contains only prose and a footnote.
      const prose = within.filter(w => realBook || w.s < quote.start + quote.text.indexOf('const answer'))
      const code = realBook ? [] : words.filter(w => ['const', 'Ctrl', 'output', 'preformatted', 'legacy'].includes(w.text))
      return { font: state.readerFont, family: pag.config.quoteFamily || pag.config.family, quoteFont: state.quoteFont, fontsLoaded: (pag.fonts || []).map(f => f.family), prose: prose.map(w => w.font), code: code.map(w => ({ text: w.text, font: w.font })),
        source: JSON.stringify(state.current.parsed.chapters), decorated: pag.pages.some(p => p.lines.some(l => l.quoteDecoration)),
        sourceOffsetsValid: prose.every(w => quote.text.slice(w.s - quote.start, w.e - quote.start).startsWith(w.text)) }
    }, !!process.env.EPUB_FILE)
    assert.equal(result.font, id)
    assert.equal(result.quoteFont, mode)
    if (mode === 'wenkai') assert.ok(result.fontsLoaded.includes('LXGW WenKai'), 'quote font is also available to page workers')
    assert.equal(result.source, original, 'font switching must preserve parsed source, ranges and note targets')
    assert.ok(result.prose.length > 0 && result.prose.every(f => f.includes(result.family)), `${id}: quoted prose must use the selected family`)
    assert.ok(result.sourceOffsetsValid && result.decorated)
    if (!process.env.EPUB_FILE) assert.ok(result.code.length >= 5 && result.code.every(w => w.font.includes('monospace')), 'code/pre/kbd/samp and non-quote tt stay monospace: ' + JSON.stringify(result.code))
    console.log('PASS', mode, id, 'quoted prose inherits selected font; source offsets and explicit code styles preserved')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading)
  assert.equal(await page.evaluate(() => window.__store.getState().quoteFont), 'wenkai', 'quote font preference survives reopening')
  assert.ok(await page.evaluate(() => window.__reader.pagination.config.quoteFamily.includes('LXGW WenKai')))
  if (await page.$('.dock-indicator[aria-expanded="false"]')) await page.click('.dock-indicator')
  await page.click('.appearance-menu > button')
  await page.waitForSelector('.font-options select[id$="-quote"]', { visible: true })
  assert.deepEqual(await page.$$eval('.font-options select[id$="-quote"] option', options => options.map(o => o.textContent)), ['霞鹜文楷', '跟随正文'])
  await page.select('.font-options select[id$="-quote"]', 'inherit')
  await page.waitForFunction(() => window.__store.getState().quoteFont === 'inherit' && !window.__store.getState().loading)
  assert.equal(await page.evaluate(() => window.__reader.pagination.config.quoteFamily), undefined)
  await page.select('.font-options select[id$="-quote"]', 'wenkai')
  await page.waitForFunction(() => window.__store.getState().quoteFont === 'wenkai' && !window.__store.getState().loading)
  console.log('PASS quotation font control updates layout and persists independently of body font')
  if (process.env.SCREENSHOT_FILE) await page.screenshot({ path: process.env.SCREENSHOT_FILE })
  assert.deepEqual(errors, [])
} finally { await browser.close() }
