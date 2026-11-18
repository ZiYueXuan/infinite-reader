// Deterministic turn-boundary regressions with local sample text; no backend calls.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5183/?sample=zh&lang=zh-CN')
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  const point = await page.evaluate(() => {
    const r = window.__reader
    r.setOpen(true); r.advance(3)
    const index = r.pagination.pages.find(p => p.index % 2 === 0 && p.lines.length > 8 && r.pagination.pages[p.index + 4]?.chapter === p.chapter).index
    r.goToLeaf(r.pageToLeafTurned(index + 2)); r.advance(3)
    const word = document.querySelectorAll(`.w[data-p="${index + 1}"]`)[12], rect = word.getBoundingClientRect()
    const point = { x: rect.left + rect.width * .8, y: rect.top + rect.height * .5, index }
    r.goToLeaf(r.pageToLeafTurned(index)); r.advance(3)
    return point
  })
  // The real cursor stays still throughout the keyboard turn.
  await page.mouse.move(point.x, point.y)
  await page.keyboard.press('ArrowRight')
  const results = await page.evaluate(point => {
    const r = window.__reader, results = []
    const check = (name, ok) => results.push({ name, ok })
    r.advance(.45)
    const hit = document.elementFromPoint(point.x, point.y)
    check('stationary cursor hits selectable text on the settling frame', !!hit?.closest('.w') && getComputedStyle(hit).cursor === 'text' && r.text.root.classList.contains('interactive'))
    check('selection layer has no delayed opacity transition', getComputedStyle(r.text.root).transitionDuration === '0s')
    const reset = () => { r.clearSelection(); window.__store.getState().setPopover(null); r.goToLeaf(r.pageToLeafTurned(point.index)); r.advance(3) }
    const move = () => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, pointerType: 'mouse', buttons: 1, clientX: point.x, clientY: point.y, bubbles: true }))
    const release = () => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'mouse', button: 0, buttons: 0, bubbles: true }))
    // Start at the same state as the edge dwell callback, then exercise real event handlers.
    const begin = () => {
      reset()
      const edge = r.text.forwardSelectionEdge(), c = r.crossSelection
      c.range = { chapter: edge.chapter, start: edge.start - 8, end: edge.end }
      c.phase = 'turning'; c.pressed = true; c.pointer = 9; c.point = { x: edge.x + 22, y: edge.y + 24 }
      c.layer.root.classList.add('cross-page-selecting'); c.host.turn(); r.advance(.05)
      return { c, edge }
    }
    let { c, edge } = begin()
    move(); r.advance(.40)
    check('cross-selection turn completes within 450ms', !r.book.busy && r.text.root.classList.contains('interactive'))
    check('movement during animation is replayed without another pointer event', c.phase === 'extending' && c.range.end > edge.end)
    check('new-page selection is painted on the settling frame', document.querySelectorAll('.sel-rect').length > 0 && r.text.root.style.opacity === '1')
    release()
    check('release preserves the resumed cross-page range', window.__store.getState().popover?.locator.end === c.range.end)
    ;({ c, edge } = begin())
    r.advance(.40)
    check('stationary pointer does not select new text or trigger another turn', c.phase === 'waiting' && c.range.end === edge.end && !c.timer)
    move()
    check('post-turn pointer movement paints synchronously', c.phase === 'extending' && c.range.end > edge.end && document.querySelectorAll('.sel-rect').length > 0)
    release()
    ;({ c, edge } = begin())
    move(); release(); r.advance(.40)
    check('release before settlement does not include unconfirmed next-page text', c.phase === 'finished' && window.__store.getState().popover?.locator.end === edge.end)
    reset()
    return results
  }, point)
  for (const result of results) console.log(result.ok ? 'PASS' : 'FAIL', result.name)
  assert.ok(results.every(result => result.ok), 'all selection readiness checks pass')

  for (const side of [1, -1]) {
    await page.mouse.move(10, 10)
    const edge = await page.evaluate(({ index, side }) => {
      const r = window.__reader
      const target = r.pageToLeafTurned(index + 2)
      r.goToLeaf(target - side)
      r.advance(3)
      return r.pagePoint(side, .95, .5)
    }, { index: point.index, side })
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y) === window.__reader.canvas, edge), true)
    await page.mouse.click(edge.x, edge.y)
    await page.evaluate(() => window.__reader.advance(.45))
    assert.ok(await page.evaluate(({ x, y, index }) => {
      const hit = document.elementFromPoint(x, y)?.closest('.w')
      return hit?.getAttribute('data-p') === String(index + 1) && !window.__reader.book.busy
    }, point), `edge click on side ${side} enables the destination text within 450ms`)
    const end = await page.evaluate(index => {
      const r = document.querySelectorAll(`.w[data-p="${index + 1}"]`)[18].getBoundingClientRect()
      return { x: r.left + r.width * .8, y: r.top + r.height * .5 }
    }, point.index)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 6 })
    await page.mouse.up()
    const selection = await page.evaluate(() => window.__store.getState().popover)
    assert.equal(selection?.kind, 'selection', `drag on side ${side} opens the highlight toolbar after the turn`)
    const count = await page.evaluate(() => window.__store.getState().annotations.length)
    await page.waitForSelector('.pop .swatches button', { visible: true })
    await page.click('.pop .swatches button')
    await page.waitForFunction(count => window.__store.getState().annotations.length === count + 1, {}, count)
    console.log('PASS edge click followed by a real drag and highlight', { side })
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
