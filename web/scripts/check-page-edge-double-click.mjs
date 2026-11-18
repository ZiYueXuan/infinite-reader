// Native browser double-clicks must turn pages without also invoking page-focus zoom.
// Run against VITE_BACKEND=local; only bundled sample content is used.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 900 } })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5205/?sample=alice&lang=en', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  const reset = async () => {
    await page.mouse.move(10, 10)
    await page.evaluate(() => {
      const r = window.__reader
      r.setOpen(true); r.advance(3); r.goToLeaf(5); r.advance(3); r.resetView(); r.advance(3)
      r.renderNow()
    })
  }
  const view = () => page.evaluate(() => {
    const r = window.__reader
    return { x: r.view.x, y: r.view.y, zoom: r.view.zoom, tx: r.view.tx, ty: r.view.ty, tzoom: r.view.tzoom }
  })
  const point = (side, u, v) => page.evaluate(({ side, u, v }) => window.__reader.pagePoint(side, u, v), { side, u, v })
  const sameView = (before, after, label) => {
    for (const key of Object.keys(before)) assert(Math.abs(before[key] - after[key]) < 0.001, `${label}: ${key} changed from ${before[key]} to ${after[key]}`)
  }
  for (const side of [1, -1]) for (const [u, v] of [[0.96, 0.5], [0.75, 0.04], [0.75, 0.96]]) {
    await reset()
    const before = await view(), p = await point(side, u, v)
    assert(await page.evaluate(p => document.elementFromPoint(p.x, p.y) === window.__reader.canvas, p), 'fixture must target the page canvas')
    // Two double-clicks reproduce the reported repeated interaction, including turns in flight.
    await page.mouse.click(p.x, p.y, { count: 2, delay: 40 })
    await page.mouse.click(p.x, p.y, { count: 2, delay: 40 })
    await page.evaluate(() => window.__reader.advance(4))
    sameView(before, await view(), `page edge ${side}/${u}/${v}`)
    const turned = await page.evaluate(() => window.__reader.book.settledTurned)
    assert(side === 1 ? turned > 5 : turned < 5, 'edge clicks must still turn pages')
    console.log('PASS repeated double-click turns without panning/zooming', { side, u, v })
  }
  await reset()
  const beforeFocus = await view(), inside = await point(1, 0.08, 0.5)
  await page.mouse.click(inside.x, inside.y, { count: 2, delay: 40 })
  await page.evaluate(() => window.__reader.advance(3))
  assert((await view()).tzoom > beforeFocus.tzoom, 'double-click outside turn zones must still focus a page')
  console.log('PASS non-turn page area retains double-click focus')
  await reset()
  const beforePan = await view()
  await page.mouse.move(40, 450); await page.mouse.down(); await page.mouse.move(140, 450, { steps: 5 }); await page.mouse.up()
  await page.evaluate(() => window.__reader.advance(3))
  assert(Math.abs((await view()).tx - beforePan.tx) > 0.01, 'intentional desk dragging must still pan')
  console.log('PASS intentional desk drag still pans')
  assert.deepEqual(errors, [])
} finally { await browser.close() }
