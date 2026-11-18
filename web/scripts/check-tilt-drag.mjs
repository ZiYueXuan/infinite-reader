// Direct-manipulation tilt: right-button drag (or Alt/Option + left drag) on the desk or book changes the camera tilt.
//
//   PUPPETEER_CORE=<puppeteer-core> READER_BASE=http://localhost:5174 node scripts/check-tilt-drag.mjs
//   SHEETS_DIR=/tmp/shots node scripts/check-tilt-drag.mjs      # also writes before/after frames
//
// Uses real (trusted) mouse input. Covers: mapping and clamps, no jump at press, cursor, persistence + live store/slider
// sync, context menu suppressed on the canvas but not on UI, a right press never cancelling or corrupting a left page drag,
// right/alt drags never turning pages / panning / selecting text, Alt+left, T cycling, the Default preset, and the
// one-time onboarding hint.
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const BASE = process.env.READER_BASE || 'http://localhost:5174'
const SHEETS = process.env.SHEETS_DIR || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fsm = SHEETS ? await import('node:fs') : null
if (fsm) fsm.mkdirSync(SHEETS, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1440, height: 900 },
})
let fails = 0
const check = (ok, msg) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`)
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

const PREFS_KEY = 'infinite-reader:prefs:v1'
async function boot(prefs) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check(false, `pageerror ${e.message}`))
  await page.evaluateOnNewDocument(
    (k, p) => {
      if (p && !sessionStorage.getItem('seeded')) {
        localStorage.setItem(k, JSON.stringify(p))
        sessionStorage.setItem('seeded', '1')
      }
    },
    PREFS_KEY,
    prefs,
  )
  await page.goto(`${BASE}/?sample=zh`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store', { timeout: 120000 })
  await page.evaluate(`window.__reader.setOpen(true); window.__reader.advance(2.5)`)
  await sleep(500)
  return { ctx, page }
}

const T = (page) => page.evaluate('window.__reader.debugTilt')
const TT = (page) => page.evaluate('window.__reader.tiltTarget')
const settle = (page, s = 3) => page.evaluate(`window.__reader.advance(${s})`)
const prefsTilt = (page) => page.evaluate(`JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}').tilt`)
const K = 1.08 / 330

const { ctx, page } = await boot({ tilt: 0.44, turnHintSeen: true, tiltHintSeen: true })
await page.evaluate(`window.__reader.goToLeaf(2); window.__reader.advance(3); window.__reader.setTilt(0.44,false)`)
await page.evaluate(`(()=>{window.__ctx=[];window.addEventListener('contextmenu',e=>window.__ctx.push({tag:e.target.tagName,cls:String(e.target.className||''),prevented:e.defaultPrevented}))})()`)
const DESK = { x: 70, y: 130 }
check(await page.evaluate(`document.elementFromPoint(${DESK.x},${DESK.y})===document.querySelector('canvas')`), 'desk probe point is the canvas')
const grabPt = await page.evaluate(`(()=>{const p=window.__reader.pagePoint(1,0.93,0.5);return p})()`)
const shot = async (name) => {
  if (!SHEETS) return
  await page.evaluate('window.__reader.renderNow()')
  await page.screenshot({ path: `${SHEETS}/${name}.png` })
}
const drag = async (from, dy, opts = {}) => {
  const { button = 'right', steps = 15, hold = 160 } = opts
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button })
  const y1 = from.y + dy
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + 2, from.y + (dy * i) / steps)
    await sleep(8)
  }
  if (hold) await sleep(hold)
  await page.evaluate('window.__reader.advance(0.5)')
  const mid = await T(page)
  await page.mouse.up({ button })
  return { mid, y1 }
}

// ---- mapping, no jump at press, cursor
await shot('before-default')
{
  const t0 = await T(page)
  await page.mouse.move(DESK.x, DESK.y)
  await page.mouse.down({ button: 'right' })
  const tPress = await T(page)
  const cur = await page.evaluate("document.querySelector('canvas').style.cursor")
  check(tPress === t0, `no jump at press (tilt ${t0.toFixed(4)} -> ${tPress.toFixed(4)})`)
  check(cur === 'ns-resize', `cursor while tilting is ns-resize (got "${cur}")`)
  await page.mouse.move(DESK.x, DESK.y + 2)
  check((await T(page)) === t0, 'sub-threshold wiggle does not tilt')
  await page.mouse.up({ button: 'right' })
  check((await page.evaluate("document.querySelector('canvas').style.cursor")) === '', 'cursor restored after release')
  await settle(page)
  check(near(await T(page), t0, 1e-6), 'a right click without movement leaves the tilt alone')
}
{
  const t0 = await T(page)
  await drag(DESK, -150)
  await settle(page)
  const t1 = await T(page)
  check(near(t1 - t0, 150 * K, 0.004), `right-drag up 150px tilts +${(150 * K).toFixed(3)} rad (got ${(t1 - t0).toFixed(3)})`)
  await shot('after-right-drag-up-150')
  await drag(DESK, 150)
  await settle(page)
  const t2 = await T(page)
  check(near(t2, t0, 0.004), `right-drag down 150px returns to the start (${t0.toFixed(3)} -> ${t2.toFixed(3)})`)
  await shot('after-right-drag-back')
}
{
  await drag(DESK, 160, { hold: 0, steps: 40 })
  await settle(page)
  await drag(DESK, 400, { steps: 30 })
  await settle(page)
  check((await T(page)) === 0, `top-down clamp is exactly TILT_MIN (got ${await T(page)})`)
  await shot('after-right-drag-topdown')
  await drag(DESK, -700, { steps: 40 })
  await settle(page)
  check(near(await T(page), 1.08, 1e-6), `oblique clamp is exactly TILT_MAX (got ${await T(page)})`)
  await shot('after-right-drag-oblique')
  const mid = await drag(DESK, 120, { steps: 20 })
  await settle(page)
  check((await T(page)) < 1.08 - 0.3, `dragging back from the clamp responds immediately (no dead zone): ${(await T(page)).toFixed(3)}`)
  void mid
}

// ---- persistence and live store/slider sync
{
  await page.evaluate('window.__reader.setTilt(0.44,false)')
  await page.evaluate("window.__store.getState().setTilt(0.44,false)")
  await page.click('.dock-indicator')
  await page.waitForFunction(() => document.querySelector('.dock').getAnimations().length === 0 && getComputedStyle(document.querySelector('.dock')).opacity === '1')
  await page.click('button[aria-label="Viewing angle"]')
  await page.waitForSelector('.tilt-slider')
  await page.mouse.move(DESK.x, DESK.y)
  await page.mouse.down({ button: 'right' })
  let live = null
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(DESK.x, DESK.y - i * 10)
    await sleep(16)
    await page.evaluate('window.__reader.advance(0.03)')
  }
  live = await page.evaluate(`({store:window.__store.getState().tilt,slider:parseFloat(document.querySelector('.tilt-slider')?.value),scene:window.__reader.debugTilt})`)
  check(Number.isFinite(live.slider), 'tilt popover stays open while right-dragging the desk')
  check(live.store > 0.5 && near(live.store, live.scene, 0.02) && near(live.slider, live.store, 0.011), `slider and store follow the drag live: ${JSON.stringify({ s: +live.store.toFixed(3), sl: live.slider, sc: +live.scene.toFixed(3) })}`)
  await shot('after-slider-live')
  await page.mouse.up({ button: 'right' })
  await settle(page)
  const fin = await T(page)
  check(near(await prefsTilt(page), fin, 0.002) && near(await page.evaluate('window.__store.getState().tilt'), fin, 0.002), `final tilt ${fin.toFixed(3)} persisted to prefs and store`)
  check(near(await page.evaluate("parseFloat(document.querySelector('.tilt-slider').value)"), fin, 0.011), 'slider shows the final tilt')
  // default preset resets
  await page.evaluate(`[...document.querySelectorAll('.tilt-presets .chip')].find(b=>/Default/.test(b.textContent)).click()`)
  await settle(page)
  check(near(await T(page), 0.44, 1e-3) && near(await prefsTilt(page), 0.44, 1e-6), 'toolbar "Default" preset resets the tilt (and persists it)')
  const tip = await page.evaluate(`document.querySelector('button[aria-label="Viewing angle"]').title+' | '+document.querySelector('.tilt-tip')?.textContent`)
  check(/right-drag/i.test(tip) && /T\b/.test(tip), `tooltip documents the gestures and T: ${tip}`)
  await page.keyboard.press('Escape')
}

// ---- T cycles presets
{
  await page.evaluate('window.__reader.setTilt(0.44,false)')
  const seen = []
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('t')
    await settle(page)
    seen.push(+(await T(page)).toFixed(2))
  }
  check(JSON.stringify(seen) === JSON.stringify([0.9, 0.02, 0.44, 0.9]), `T cycles default -> oblique -> top-down -> default -> oblique: ${JSON.stringify(seen)}`)
  check(near(await prefsTilt(page), 0.9, 1e-6), 'T-cycled tilt persists')
  await page.evaluate('window.__reader.setTilt(0.44,false)')
  await page.evaluate("window.__store.getState().setTilt(0.44,false)")
}

// ---- context menu: suppressed on the canvas, not on UI
{
  await page.evaluate('window.__ctx.length=0')
  await page.mouse.click(DESK.x, DESK.y, { button: 'right' })
  await sleep(100)
  await page.mouse.click(DESK.x, DESK.y, { button: 'right' })
  const cv = await page.evaluate('window.__ctx.filter(c=>c.tag==="CANVAS")')
  check(cv.length >= 1 && cv.every((c) => c.prevented), `contextmenu on the canvas is prevented (${cv.length} events)`)
  const ui = await page.evaluate(`(()=>{const b=document.querySelector('.dock button')||document.querySelector('[data-ui] button');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await page.evaluate('window.__ctx.length=0')
  await page.mouse.click(ui.x, ui.y, { button: 'right' })
  await sleep(100)
  const uiEv = await page.evaluate('window.__ctx')
  check(uiEv.length >= 1 && uiEv.every((c) => !c.prevented), `contextmenu on UI chrome is left alone (${uiEv.map((c) => c.tag).join(',')})`)
  await page.evaluate('window.__reader.advance(0.1)')
}

// ---- right drag never turns pages, pans, or selects
const snapState = () => page.evaluate(`(()=>{const R=window.__reader,b=R.book;return {turned:b.turned,flyers:b.flyers.length,held:b.hasHeldLeaf,psi:b.psi,vx:R.view.x,vy:R.view.y,drag:R.drag?R.drag.kind:null,sel:String(window.getSelection())}})()`)
{
  await page.evaluate('window.__reader.setTilt(0.44,false)')
  const s0 = await snapState()
  const mid = await drag(grabPt, -120, { steps: 12 })
  const sm = await snapState()
  await settle(page)
  const s1 = await snapState()
  check(s1.turned === s0.turned && s1.flyers === 0 && !sm.held && sm.flyers === 0, `right-drag from the page-turn grab zone does not turn or lift a page (turned ${s0.turned}->${s1.turned})`)
  check(near(s1.vx, s0.vx, 1e-6) && near(s1.vy, s0.vy, 1e-6), 'right-drag does not pan the desk')
  check(sm.sel === '' && s1.sel === '', 'right-drag selects no text')
  check(mid.mid > 0.44 + 0.2, `right-drag from the corner tilts (mid-drag ${mid.mid.toFixed(3)})`)
  await page.evaluate('window.__reader.setTilt(0.44,false)')
  // over text words
  const word = await page.evaluate(`(()=>{const sp=[...document.querySelectorAll('.text-layer span.w')].find(s=>{const r=s.getBoundingClientRect();return r.width>4&&r.top>150&&r.top<700&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===s});if(!sp)return null;const r=sp.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  if (word) {
    await page.evaluate('window.__ctx.length=0')
    await drag(word, -100, { steps: 10 })
    const sel = await page.evaluate('String(window.getSelection())')
    const ctxEv = await page.evaluate('window.__ctx')
    const t = await T(page)
    check(sel === '' && t > 0.44 + 0.1, `right-drag over book text tilts without selecting (sel="${sel}", tilt ${t.toFixed(3)})`)
    check(ctxEv.every((c) => c.prevented), `contextmenu over book text during a tilt gesture is prevented (${ctxEv.length} events)`)
    await page.evaluate('window.__reader.setTilt(0.44,false)')
  } else console.log('note: no interactive text word under a probe point; text-layer case skipped')
}

// ---- left drag unaffected; right press during a left page drag changes nothing
{
  await page.evaluate('window.__reader.setTilt(0.44,false); window.__reader.advance(0.1)')
  const s0 = await snapState()
  await page.mouse.move(DESK.x, DESK.y)
  await page.mouse.down()
  await page.mouse.move(DESK.x + 160, DESK.y + 40, { steps: 8 })
  await page.evaluate('window.__reader.advance(0.05)')
  const s1 = await snapState()
  check(s1.drag === 'pan' && (Math.abs(s1.vx - s0.vx) > 0.01 || Math.abs(s1.vy - s0.vy) > 0.01) && near(await T(page), 0.44, 1e-6), 'left-drag still pans the desk and leaves the tilt alone')
  await page.mouse.up()
  await settle(page)
  await page.evaluate('window.__reader.resetView()')
  await settle(page)

  const g = await page.evaluate(`window.__reader.pagePoint(1,0.93,0.5)`)
  const t0 = await T(page)
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  await page.mouse.move(g.x - 120, g.y - 10, { steps: 8 })
  await page.evaluate('window.__reader.advance(0.1)')
  const a = await snapState()
  check(a.drag === 'page' && a.held, 'left press on the page corner starts a page drag')
  await page.evaluate('window.__ctx.length=0')
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(g.x - 200, g.y - 10, { steps: 6 })
  await page.mouse.up({ button: 'right' })
  await page.evaluate('window.__reader.advance(0.1)')
  const b = await snapState()
  check(b.drag === 'page' && b.held && near(await T(page), t0, 1e-6), `right press/release during a left page drag does not cancel or tilt (drag=${b.drag}, held=${b.held}, tilt ${(await T(page)).toFixed(3)})`)
  const cx = await page.evaluate('window.__ctx')
  check(cx.every((c) => c.prevented), `chorded contextmenu is prevented (${cx.length} events), so no menu steals the left up`)
  await page.mouse.move(g.x - 420, g.y - 10, { steps: 8 })
  await page.mouse.up()
  await settle(page, 4)
  const c = await snapState()
  check(c.turned === s0.turned + 1 && c.flyers === 0 && !c.held && c.drag === null, `the left drag completed a clean page turn (turned ${s0.turned}->${c.turned})`)
  // and back
  await page.evaluate(`window.__reader.turn(-1)`)
  await settle(page, 4)
}

// ---- Alt/Option + left drag
{
  await page.evaluate('window.__reader.setTilt(0.44,false)')
  const s0 = await snapState()
  const g = await page.evaluate(`window.__reader.pagePoint(1,0.93,0.5)`)
  await page.keyboard.down('Alt')
  const m = await drag(g, -120, { button: 'left', steps: 12 })
  await page.keyboard.up('Alt')
  await settle(page)
  const s1 = await snapState()
  const t = await T(page)
  check(m.mid > 0.44 + 0.2 && t > 0.44 + 0.2, `Alt+left-drag tilts (mid ${m.mid.toFixed(3)}, final ${t.toFixed(3)})`)
  check(s1.turned === s0.turned && s1.flyers === 0 && s1.sel === '', 'Alt+left-drag turns no page and selects nothing')
  check(near(await prefsTilt(page), t, 0.002), 'Alt-drag tilt persists')
  await page.evaluate('window.__reader.setTilt(0.44,false)')
}

// ---- inertia: a fast flick keeps gliding a little, bounded
{
  await page.evaluate('window.__reader.setTilt(0.44,false)')
  await page.mouse.move(DESK.x, DESK.y + 200)
  await page.mouse.down({ button: 'right' })
  for (let i = 1; i <= 6; i++) await page.mouse.move(DESK.x, DESK.y + 200 - i * 12)
  await page.mouse.up({ button: 'right' })
  const target = await TT(page)
  await settle(page)
  const fin = await T(page)
  check(near(fin, target, 1e-3) && fin >= 0.44 + 72 * K - 0.01 && fin <= 0.44 + 72 * K + 0.3, `flick glides slightly past the drag distance and settles (drag-only ${(0.44 + 72 * K).toFixed(3)}, final ${fin.toFixed(3)})`)
  await page.evaluate('window.__reader.setTilt(0.44,false)')
}

// ---- no leaked tilt state after blur mid-drag
{
  await page.mouse.move(DESK.x, DESK.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(DESK.x, DESK.y - 60, { steps: 5 })
  await page.evaluate("window.dispatchEvent(new Event('blur'))")
  const s = await snapState()
  check(s.drag === null, 'window blur ends a tilt drag')
  await page.mouse.up({ button: 'right' })
  await settle(page)
  check(near(await prefsTilt(page), await T(page), 0.002), 'blur mid-drag still persists the tilt')
  await page.evaluate('window.__reader.setTilt(0.44,false)')
}
await ctx.close()

// ---- onboarding hint
{
  const { ctx: c2, page: p2 } = await boot({ tilt: 0.44, turnHintSeen: true, tiltHintSeen: false })
  await p2.evaluate('window.__reader.goToLeaf(2); window.__reader.advance(3)')
  await p2.waitForSelector('.tilt-hint.on', { timeout: 8000 }).then(
    () => check(true, 'tilt hint appears after the book opens'),
    () => check(false, 'tilt hint appears after the book opens'),
  )
  const txt = await p2.evaluate("document.querySelector('.tilt-hint')?.textContent||''")
  check(/Right-drag to tilt the view/.test(txt), `hint text: "${txt}"`)
  if (SHEETS) {
    await p2.screenshot({ path: `${SHEETS}/after-onboarding-hint.png` })
  }
  await p2.mouse.move(DESK.x, DESK.y)
  await p2.mouse.down({ button: 'right' })
  await p2.mouse.move(DESK.x, DESK.y - 40, { steps: 6 })
  await p2.mouse.up({ button: 'right' })
  await sleep(200)
  const hidden = await p2.evaluate("!document.querySelector('.tilt-hint').classList.contains('on')")
  const stored = await p2.evaluate(`JSON.parse(localStorage.getItem('${PREFS_KEY}')).tiltHintSeen`)
  check(hidden && stored === true, 'first tilt gesture dismisses the hint and remembers it')
  await p2.reload({ waitUntil: 'domcontentloaded' })
  await p2.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store', { timeout: 120000 })
  await p2.evaluate('window.__reader.setOpen(true); window.__reader.advance(2.5)')
  await sleep(3500)
  check(await p2.evaluate("!document.querySelector('.tilt-hint').classList.contains('on')"), 'hint stays dismissed after a reload')
  await c2.close()
  // hint waits for the turn hint to be done
  const { ctx: c3, page: p3 } = await boot({ tilt: 0.44, turnHintSeen: false, tiltHintSeen: false })
  await sleep(3500)
  check(await p3.evaluate("!document.querySelector('.tilt-hint').classList.contains('on')"), 'tilt hint does not overlap the page-turn hint')
  await c3.close()
}
await browser.close()
if (fails) {
  console.log(`FAILED (${fails})`)
  process.exit(1)
}
console.log('PASS')
