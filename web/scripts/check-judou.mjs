// Exercise clause marks on a local EPUB with known source offsets and no backend calls.
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const url = new URL(process.env.READER_URL || 'http://127.0.0.1:5183')
url.searchParams.set('sample', 'zh')
url.searchParams.set('lang', 'zh-CN')

const zip = new JSZip()
zip.file('mimetype', 'application/epub+zip')
zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
zip.file('book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">judou-test</dc:identifier><dc:title>句读测试</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>')
zip.file('text.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>句读测试</title></head><body><p>天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏𠮷古文</p><p>江河湖海</p></body></html>')
const epub = await zip.generateAsync({ type: 'nodebuffer' })

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 900 },
})
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => new URL(request.url()).pathname.endsWith('/samples/zh-sample.epub')
    ? request.respond({ contentType: 'application/epub+zip', body: epub }) : request.continue())
  async function openFixture() {
    await page.goto(url.href)
    await page.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading &&
      __store.getState().current?.meta.title === '句读测试', { timeout: 120000 })
  }
  await openFixture()
  await page.evaluate(() => {
    const r = window.__reader
    r.setOpen(true)
    const body = r.pagination.pages.find(p => p.lines.some(line => line.words.some(w => w.text === '宇')))
    r.goToLeaf(r.pageToLeafTurned(body.index))
    r.advance(3)
  })
  await page.waitForSelector('.text-layer.interactive .w')

  async function drag(from, to) {
    const [a, b] = await page.evaluate((from, to) => {
      const spans = Array.from(__reader.text.root.querySelectorAll('.w'))
      return [from, to].map((char, i) => {
        const rect = spans.find(el => el.textContent === char).getBoundingClientRect()
        return { x: rect.left + rect.width * (i ? .84 : .16), y: rect.top + rect.height / 2 }
      })
    }, from, to)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForSelector('.pop .swatches', { visible: true })
  }
  await drag('宇', '日')
  await page.click('.pop .swatches button')
  await page.waitForFunction(() => __store.getState().annotations.some(m => m.kind === 'highlight'))
  await drag('宙', '洪')
  await page.click('button[aria-label="句读"]')
  await page.waitForFunction(() => __store.getState().annotations.some(m => m.kind === 'judou'))

  // Project the painted slash centre through the same word box that the real mouse will hit.
  const point = await page.evaluate(async () => {
    const { rangeRects, judouAnchor, contentOrigin } = await import('/src/book/pageRender.ts')
    const text = __reader.text, { locator } = __store.getState().annotations.find(m => m.kind === 'judou')
    const slot = text.slots.find(s => s.page?.chapter === locator.chapter && s.page.start < locator.end && s.page.end > locator.start)
    const rect = rangeRects(slot.page, locator.start, locator.end)[0]
    const a = judouAnchor(rect, text.cfg), origin = contentOrigin(slot.page, text.cfg)
    const box = slot.words.find(w => Number(w.el.dataset.s) < locator.end && Number(w.el.dataset.e) > locator.start)
    const projected = new DOMPoint(a.x + a.lean / 2 + origin.x - box.x, a.y + a.h / 2 + origin.y - box.y)
      .matrixTransform(new DOMMatrix(box.el.style.transform))
    const host = text.root.getBoundingClientRect()
    return { x: host.left + projected.x / projected.w, y: host.top + projected.y / projected.w }
  })
  await page.mouse.click(point.x, point.y)
  await page.waitForSelector('.mark-popover .judou-preview', { visible: true })
  await page.click('.mark-popover button.danger')
  await page.waitForFunction(() => __store.getState().annotations.length === 1)
  assert.equal(await page.evaluate(() => __store.getState().annotations[0].kind), 'highlight')

  for (const [char, caret] of [['𠮷', false], ['江', true]]) {
    const start = await page.evaluate((char, caret) => {
      document.activeElement?.blur?.()
      const el = Array.from(__reader.text.root.querySelectorAll('.w')).find(w => w.textContent === char)
      getSelection().setBaseAndExtent(el.firstChild, 0, el.firstChild, caret ? 0 : char.length)
      return Number(el.dataset.s)
    }, char, caret)
    await page.keyboard.press('/')
    await page.waitForFunction(offset => __store.getState().annotations.some(m => m.kind === 'judou' && m.locator.start === offset), {}, start)
    const mark = await page.evaluate(offset => __store.getState().annotations.find(m => m.kind === 'judou' && m.locator.start === offset), start)
    assert.equal(mark.quote, char)
    assert.equal(mark.locator.end, start + char.length)
  }
  const expected = [['highlight', '宇宙洪荒日'], ['judou', '江'], ['judou', '𠮷']].sort()
  const written = await page.evaluate(async () => {
    const { storage } = await import('/src/storage/index.ts')
    return (await storage.listAnnotations(__store.getState().current.meta.id)).map(m => [m.kind, m.quote]).sort()
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(written, expected, 'the reader persisted all three annotations')
  await openFixture()
  const saved = await page.evaluate(() => __store.getState().annotations.map(m => [m.kind, m.quote]).sort())
  assert.deepEqual(saved, expected, 'reopening the book restored all three annotations')
  console.log('PASS overlapping mark deletion, whole grapheme and paragraph-start anchors, and persisted quotes')
} finally {
  await browser.close()
}
