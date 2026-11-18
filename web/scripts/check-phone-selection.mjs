// Isolated local sample: custom long-press selection, annotation tools, and native UI boundaries.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true })
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
try {
  const p = await browser.newPage(), errors = [], api = []
  p.on('pageerror', e => errors.push(e.message))
  p.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()) })
  await p.emulate({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', viewport: { width: 430, height: 739, deviceScaleFactor: 3, isMobile: true, hasTouch: true } })
  await p.goto(`${process.env.READER_ORIGIN || 'http://127.0.0.1:5198'}/?sample=zh&lang=zh-CN`)
  await p.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading, { timeout: 120000 })
  await p.evaluate(() => __reader.goToLeaf(2))
  await p.waitForFunction(() => __reader.visiblePages.right === 2 && document.querySelector('.text-layer.interactive .w'))
  const points = await p.$$eval('.text-page .w', words => [words[8], words[32]].map(w => { const r = w.getBoundingClientRect(); return { x: r.left + r.width * .8, y: r.top + r.height / 2 } }))
  check(await p.$eval('.text-page .w', w => getComputedStyle(w).userSelect === 'none'), 'phone text does not create a native selection')
  check(await p.$eval('.text-page .w', w => !w.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), 'browser context menu is prevented on book text')
  check(await p.$eval('.text-page .w', w => !w.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }))), 'native touch defaults are prevented on book text')
  const c = await p.createCDPSession()
  const touch = (type, point = points[0]) => c.send('Input.dispatchTouchEvent', { type, touchPoints: /End|Cancel/.test(type) ? [] : [{ ...point, id: 1 }] })
  const hold = async () => {
    // Reflow can replace the text layer; read coordinates from the same ready frame.
    const readyWord = await p.waitForFunction(() => {
      const w = document.querySelectorAll('.text-layer.interactive .w')[8], r = w?.getBoundingClientRect()
      if (!r || r.width <= 0 || r.height <= 0 || document.elementFromPoint(r.left + r.width * .8, r.top + r.height / 2) !== w) return false
      return { point: { x: r.left + r.width * .8, y: r.top + r.height / 2 }, start: Number(w.dataset.s), end: Number(w.dataset.e) }
    })
    const word = await readyWord.jsonValue()
    await readyWord.dispose()
    points[0] = word.point
    await touch('touchStart'); await new Promise(r => setTimeout(r, 560))
    await p.waitForFunction(() => document.querySelectorAll('.pseudo-sel .sel-rect').length > 0 && !__store.getState().popover && !document.querySelector('.pop'))
    return word
  }
  const initial = await hold()
  const highlightWidth = () => p.$$eval('.pseudo-sel .sel-rect', rects => rects.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0))
  const initialWidth = await highlightWidth()
  check(await p.evaluate(() => getSelection().rangeCount === 0 && !__store.getState().popover && !document.querySelector('.pop')), 'long press shows only a custom highlight, with no native range or toolbar')
  await touch('touchMove', points[1])
  check(await highlightWidth() > initialWidth && await p.evaluate(() => !__store.getState().popover && !document.querySelector('.pop')), 'held drag expands the highlight without displaying a moving toolbar')
  await touch('touchEnd')
  await p.waitForSelector('.pop', { visible: true })
  const selected = await p.evaluate(() => __store.getState().popover)
  check(!!selected.text && selected.locator.start === initial.start && selected.locator.end > initial.end, 'release opens tools for the final expanded source range')
  check(await p.evaluate(() => __reader.visiblePages.right === 2 && !__reader.book.busy), 'selection drag and release never turn a page')
  const toolbarPosition = await p.$eval('.pop', el => el.style.transform)
  await p.mouse.move(300, 500)
  check(await p.$eval('.pop', el => el.style.transform) === toolbarPosition, 'toolbar position stays fixed after release')
  await p.click('.pop .seg button:last-child'); await p.click('.pop .sw')
  await p.waitForFunction(() => __store.getState().annotations.length > 0)
  const mark = await p.evaluate(() => __store.getState().annotations.at(-1))
  check(mark.kind === 'underline' && mark.quote === selected.text && mark.locator.end === selected.locator.end, 'underline tool saves the exact selected passage')
  const singleWord = await hold(); await touch('touchEnd')
  await p.waitForSelector('.pop', { visible: true })
  check(await p.evaluate(word => { const pop = __store.getState().popover; return pop.locator.start === word.start && pop.locator.end === word.end }, singleWord), 'stationary long press also waits for release and selects exactly one word')
  const askText = await p.evaluate(() => __store.getState().popover.text)
  await p.click('.pop .askbtn')
  check(await p.evaluate(text => __store.getState().ask?.text === text, askText), 'AI panel receives the selected source passage without sending a request')
  await p.evaluate(() => __store.getState().closeAsk())
  await p.waitForFunction(() => !__reader.interactionSuspended && !__store.getState().ask)
  await hold(); await touch('touchEnd')
  await p.waitForSelector('.pop', { visible: true })
  await p.click('.pop button[aria-label="添加行内笔记"]')
  await p.waitForSelector('.note-rich-content', { visible: true })
  check(await p.$eval('.note-rich-content', el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), 'native copy/paste menu stays available inside the note editor')
  check(await p.$eval('.note-rich-content', el => el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }))), 'note editor keeps normal touch defaults')
  const layoutBeforeNote = await p.evaluate(() => __reader.pagination.noteSignature)
  await p.click('[data-note-done]')
  await p.waitForFunction(previous => !__store.getState().editingNote && __reader.pagination.noteSignature !== previous, {}, layoutBeforeNote)
  for (const reason of ['touchCancel', 'second-finger', 'blur']) {
    await hold()
    if (reason === 'touchCancel') await touch('touchCancel')
    else if (reason === 'second-finger') {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }, { x: 360, y: 550, id: 2 }] })
      await touch('touchEnd')
    } else { await p.evaluate(() => window.dispatchEvent(new Event('blur'))); await touch('touchEnd') }
    check(await p.evaluate(() => !__store.getState().popover && !document.querySelector('.pop') && !document.querySelector('.pseudo-sel .sel-rect') && __reader.visiblePages.right === 2), `${reason} discards the provisional selection without tools or page turns`)
  }
  const desktop = await browser.newPage()
  await desktop.setViewport({ width: 1440, height: 900 })
  await desktop.goto(`${process.env.READER_ORIGIN || 'http://127.0.0.1:5198'}/?sample=zh&lang=en`)
  await desktop.waitForFunction(() => window.__reader?.hasBook && !__store.getState().loading)
  await desktop.evaluate(() => { __reader.goToLeaf(2); __reader.advance(4) })
  check(await desktop.$eval('.text-page .w', w => getComputedStyle(w).userSelect === 'text' && w.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), 'desktop text retains native selection and context menus')
  check(api.length === 0, 'sample validation stays offline')
  check(errors.length === 0, `no runtime errors: ${errors.join('; ')}`)
} finally { await browser.close() }
