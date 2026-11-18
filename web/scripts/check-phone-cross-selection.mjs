// Local-mode sample, actual touch events and page animations; no account or production data.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true })
const page = await browser.newPage(), errors = [], api = []
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
page.on('pageerror', e => errors.push(e.message))
page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()) })
const ipad = process.env.READER_DEVICE === 'ipad-mini'
await page.emulate({ userAgent: ipad
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
  : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
viewport: { width: ipad ? 744 : 430, height: ipad ? 1040 : 739, deviceScaleFactor: ipad ? 2 : 3, isMobile: !ipad, hasTouch: true } })
const cdp = await page.createCDPSession()
if (ipad) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: /End|Cancel/.test(type) ? [] : [{ x: point.x, y: point.y, id: 1 }] })
const at = (index, position) => page.evaluate(({ index, position }) => {
  const words = [...document.querySelectorAll(`.text-layer.interactive .w[data-p="${index}"]`)]
  const w = words[position < 0 ? words.length + position : position], r = w.getBoundingClientRect()
  return { x: r.left + r.width * .8, y: r.top + r.height / 2, start: Number(w.dataset.s), end: Number(w.dataset.e), chapter: Number(w.dataset.c) }
}, { index, position })
const corner = () => page.evaluate(() => ({ x: innerWidth - 12, y: innerHeight - 18 }))
const settled = index => page.waitForFunction(index => __reader.visiblePages.right === index && !__reader.book.busy && !!document.querySelector(`.text-layer.interactive .w[data-p="${index}"]`), {}, index)
const go = async index => {
  await page.evaluate(index => { __reader.clearSelection(); __store.getState().setPopover(null); __reader.goToLeaf(index) }, index)
  await settled(index)
}
const hold = async (index, position = -8) => {
  await go(index)
  const word = await at(index, position)
  await touch('touchStart', word)
  await page.waitForFunction(() => document.querySelector('.pseudo-sel .sel-rect') && !__store.getState().popover)
  return word
}
const turn = async index => {
  await touch('touchMove', await corner())
  await page.waitForFunction(() => __reader.book.busy, { timeout: 5000 })
  await settled(index + 1)
}
const selected = async () => {
  await page.waitForSelector('.pop', { visible: true })
  return page.evaluate(() => __store.getState().popover)
}
try {
  await page.goto(`${process.env.READER_ORIGIN || 'http://127.0.0.1:5198'}/?sample=zh&lang=zh-CN`)
  await page.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading, { timeout: 120000 })
  const index = await page.evaluate(() => __reader.pagination.pages.find(p => p.index >= 2 && p.lines.length > 6 && __reader.pagination.pages[p.index + 2]?.chapter === p.chapter)?.index)
  assert.ok(index >= 2, 'sample has three consecutive body pages in one chapter')
  let start = await hold(index), end = await at(index, -1)
  await touch('touchMove', await corner()); await touch('touchMove', end); await delay(650)
  check(await page.evaluate(index => __reader.visiblePages.right === index && !__reader.book.busy && !__store.getState().popover, index), 'leaving the corner before dwell cancels the turn without opening tools')
  await touch('touchEnd'); await selected()

  start = await hold(index)
  const pageEnd = await page.evaluate(index => __reader.pagination.pages[index].end, index)
  await turn(index)
  check(await page.evaluate(() => !__store.getState().popover && getSelection().rangeCount === 0), 'corner dwell turns exactly one phone page without native selection or a toolbar')
  await delay(800)
  check(await page.evaluate(index => __reader.visiblePages.right === index && !__reader.book.busy, index + 1), 'holding the old corner never skips or repeatedly turns pages')
  end = await at(index + 1, 12)
  await touch('touchMove', end); await touch('touchEnd')
  let selection = await selected()
  check(selection.locator.start === start.start && selection.locator.end === end.end && selection.locator.end > pageEnd, 'selection continues across replaced word nodes from the original anchor')
  check(await page.evaluate(() => {
    const s = __store.getState(), p = s.popover
    return p.text === s.current.parsed.chapters[p.locator.chapter].blocks
      .filter(b => !b.footnoteDefinition && b.start < p.locator.end && b.start + b.text.length > p.locator.start)
      .map(b => b.text.slice(Math.max(0, p.locator.start - b.start), p.locator.end - b.start)).join('\n')
  }), 'final quote includes all intervening source text')
  await page.click('.pop .seg button:last-child'); await page.click('.pop .sw')
  check(await page.evaluate(selection => { const marks = __store.getState().annotations; return marks.length === 1 && marks[0].kind === 'underline' && marks[0].quote === selection.text && JSON.stringify(marks[0].locator) === JSON.stringify(selection.locator) }, selection), 'cross-page underline saves as one exact annotation')
  await page.reload()
  await page.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading, { timeout: 120000 })
  check(await page.evaluate(selection => __store.getState().annotations[0]?.quote === selection.text, selection), 'cross-page annotation survives reload')

  start = await hold(index)
  await turn(index)
  await touch('touchMove', await at(index + 1, 6))
  await turn(index + 1)
  end = await at(index + 2, 10)
  await touch('touchMove', end); await touch('touchEnd'); selection = await selected()
  check(selection.locator.start === start.start && selection.locator.end === end.end, 'one held finger can select across two turns after re-entering text')
  check(await page.evaluate(() => { const e = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented && e.clipboardData.getData('text/plain') === __store.getState().popover.text }), 'copy receives the complete multi-page passage')

  await hold(index)
  const confirmedEnd = await page.evaluate(() => __reader.text.forwardSelectionEdge().end)
  await touch('touchMove', await corner()); await page.waitForFunction(() => __reader.book.busy)
  await touch('touchEnd'); await settled(index + 1); selection = await selected()
  check(selection.locator.end === confirmedEnd, 'lifting during a turn opens tools after settling and preserves only the confirmed range')

  for (const reason of ['touchCancel', 'second-finger', 'blur']) {
    await hold(index); const point = await corner(); await touch('touchMove', point)
    if (reason === 'touchCancel') await touch('touchCancel')
    else if (reason === 'second-finger') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }, { x: 100, y: 200, id: 2 }] })
      await touch('touchEnd')
    } else { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await touch('touchEnd') }
    await delay(650)
    check(await page.evaluate(index => __reader.visiblePages.right === index && !__store.getState().popover && !document.querySelector('.pseudo-sel .sel-rect'), index), `${reason} cancels the pending edge turn and provisional selection`)
  }
  await hold(index); const point = await corner(); await touch('touchMove', point)
  await page.waitForFunction(() => __reader.book.busy)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }, { x: 100, y: 200, id: 2 }] })
  await touch('touchEnd'); await settled(index + 1)
  check(await page.evaluate(() => !__store.getState().popover && !document.querySelector('.pseudo-sel .sel-rect')), 'a second finger during the animation cancels selection without a stale toolbar')

  start = await hold(index, 32)
  await touch('touchMove', await at(index, 8)); await touch('touchEnd'); selection = await selected()
  check(selection.locator.start < start.start && selection.locator.end === start.end, 'backward selection within the starting page remains supported')
  const boundary = await page.evaluate(() => __reader.pagination.pages.find(p => p.lines.length > 2 && !p.special && __reader.pagination.pages[p.index + 1]?.chapter !== p.chapter)?.index)
  await hold(boundary); await touch('touchMove', await corner()); await delay(650)
  check(await page.evaluate(boundary => __reader.visiblePages.right === boundary && !__reader.book.busy && document.querySelector('.selection-turn-hint').textContent.includes('章节末尾'), boundary), 'chapter boundary shows a touch-specific hint without selecting another chapter')
  await touch('touchEnd'); await selected()
  check(api.length === 0, 'validation never calls production APIs')
  check(errors.length === 0, `no runtime errors: ${errors.join('; ')}`)
} catch (error) {
  await page.screenshot({ path: '/tmp/phone-cross-selection-failure.png' })
  console.log('STATE', await page.evaluate(() => { const r = window.__reader, s = r?.crossSelection; return { right: r?.visiblePages.right, busy: r?.book?.busy, phase: s?.phase, range: s?.range, pressed: s?.pressed, point: s?.point, gesture: r?.phoneGestures.press, hint: document.querySelector('.selection-turn-hint')?.textContent, popover: window.__store?.getState().popover } }))
  throw error
} finally { await browser.close() }
