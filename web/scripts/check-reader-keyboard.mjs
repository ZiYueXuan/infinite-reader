// Local sample only: keyboard focus, animation ordering, and control ownership.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5183/?sample=zh&lang=en')
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  const results = await page.evaluate(() => {
    const r = window.__reader, results = []
    r.paused = true
    const key = (target, name, extra = {}) => {
      const e = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra })
      target.dispatchEvent(e)
      return e.defaultPrevented
    }
    const reset = () => {
      document.activeElement?.blur()
      r.setOpen(true); r.advance(3); r.goToLeaf(2); r.advance(3)
    }
    const check = (name, ok) => results.push({ name, ok })
    reset()
    key(document.body, 'ArrowRight')
    check('first key starts a leaf in the keydown handler', r.book.turned === 3 && r.book.flyers.length === 1)
    r.advance(1 / 60)
    check('keyboard turn visibly moves on its first frame', r.book.flyers[0].phi > .1)
    r.advance(.13)
    key(document.body, 'ArrowRight')
    check('same-direction second press starts without waiting for settlement', r.book.turned === 4 && r.book.flyers.length === 2)
    r.advance(.45)
    check('quick concurrent leaves settle within 450ms', !r.book.busy && r.book.settledTurned === 4)
    reset()
    key(document.body, 'ArrowRight'); r.advance(.15); key(document.body, 'ArrowLeft')
    check('reverse direction waits safely instead of crossing sheets', r.book.flyers.length === 1 && r.book.turned === 3)
    r.advance(.30)
    check('reverse starts within 300ms of a mid-turn press', r.book.turned === 2 && r.book.flyers.length === 1)
    r.advance(.45)
    check('reverse settles to the correct spread', !r.book.busy && r.book.settledTurned === 2)
    reset()
    r.turn(1); r.advance(.45)
    check('programmatic toolbar turns retain their natural animation', r.book.busy && r.book.flyers.every(f => !f.quick))
    key(document.body, 'ArrowRight')
    check('quick keyboard leaves do not overtake a natural flight', r.book.turned === 3 && r.book.flyers.length === 1)
    r.advance(.20)
    check('keyboard starts within 200ms after a natural flight', r.book.turned === 4 && r.book.flyers.length === 1)
    r.advance(.45)
    check('mouse then keyboard settles within 650ms of the key', r.book.turned === 4 && !r.book.busy)
    for (const side of [1, -1]) for (const elapsed of [0, .15, 1.2]) for (const dir of [1, -1]) {
      reset()
      r.turn(side); r.advance(elapsed)
      const prior = r.book.flyers[0], before = prior?.phi
      key(document.body, dir === 1 ? 'ArrowRight' : 'ArrowLeft')
      check(`handoff keeps current angle or starts immediately after settlement: side=${side}, age=${elapsed}, key=${dir}`, prior ? prior.phi === before : r.book.turned === 2 + side + dir)
      r.advance(.20)
      check(`handoff admits key within 200ms: side=${side}, age=${elapsed}, key=${dir}`, r.book.turned === 2 + side + dir && r.book.flyers.length === 1 && !r.book.flyers[0].quick?.handoff)
      r.advance(.45)
      check(`handoff lands correctly: side=${side}, age=${elapsed}, key=${dir}`, !r.book.busy && r.book.settledTurned === 2 + side + dir)
    }
    reset()
    r.turn(1, 3); r.advance(.25); key(document.body, 'ArrowLeft'); r.advance(.20)
    check('a multi-leaf mouse flight completes in order before a reverse key', r.book.turned === 4 && r.book.flyers.length === 1)
    r.advance(.45)
    check('multi-leaf handoff settles without losing pages', !r.book.busy && r.book.settledTurned === 4)
    reset()
    r.book.beginDrag(1, .94, .5)
    // Model-only hold: scene stepping would correctly release an orphaned pointer.
    r.book.update(1 / 60)
    check('quick turns cannot take over a held mouse leaf', r.book.turn(1, 1, 'quick') === 0 && r.book.hasHeldLeaf && !r.book.flyers[0].quick)
    // A short drag released back onto its starting stack must not become a completed mouse turn.
    r.book.endDrag(0, true); key(document.body, 'ArrowRight'); r.advance(.65)
    check('cancelled mouse drag plus keyboard advances exactly one leaf', !r.book.busy && r.book.settledTurned === 3)
    reset()
    const indicator = document.querySelector('.dock-indicator')
    indicator.focus(); key(indicator, 'ArrowRight'); r.advance(3)
    check('focused collapsed-toolbar indicator permits ArrowRight', r.book.turned === 3)
    reset()
    // Reveal the actual dock and focus its page button.
    indicator.click()
    const dock = document.querySelector('.reader-dock')
    const button = dock.querySelector('.dock button')
    button.focus(); key(button, 'ArrowLeft'); r.advance(3)
    check('focused toolbar button permits ArrowLeft', r.book.turned === 1)
    reset()
    check('Space retains native button activation', !key(indicator, ' '))
    key(document.body, 'ArrowRight'); key(document.body, 'ArrowLeft'); r.advance(6)
    check('opposite-direction press during animation is retained', r.book.turned === 2)
    reset()
    key(document.body, 'ArrowRight'); key(document.body, 'ArrowRight'); key(document.body, 'ArrowLeft'); r.advance(9)
    check('separate rapid presses retain their order', r.book.turned === 3)
    reset()
    key(document.body, 'ArrowRight')
    for (let i = 0; i < 30; i++) key(document.body, 'ArrowRight', { repeat: true })
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    r.advance(6)
    check('release stops queued auto-repeat turns', r.book.turned === 3)
    reset()
    key(document.body, 'PageDown'); r.advance(3); key(document.body, 'PageUp'); r.advance(3)
    check('PageDown/PageUp continue working', r.book.turned === 2)
    reset()
    for (const html of ['<textarea></textarea>', '<input type="range">', '<select><option>a</option></select>', '<div contenteditable="true"><span>edit</span></div>', '<div role="dialog"><button>dialog</button></div>', '<div data-ui><button>other UI</button></div>', '<div data-ui data-atlas-dock><input></div>', '<div data-ui data-atlas-dock><div role="dialog"><button>dialog</button></div></div>']) {
      const wrapper = document.createElement('div'); wrapper.innerHTML = html; document.body.append(wrapper)
      const target = wrapper.querySelector('span,button,input') || wrapper.firstElementChild
      target.focus(); const consumed = key(target, 'ArrowRight'); r.advance(3)
      check(`control retains arrow key: ${html}`, !consumed && r.book.turned === 2)
      wrapper.remove()
    }
    for (const tag of ['canvas', 'button']) {
      reset()
      const dock = document.createElement('div'); dock.dataset.ui = ''; dock.dataset.atlasDock = ''
      const target = document.createElement(tag); target.tabIndex = 0; dock.append(target); document.body.append(dock)
      target.focus(); key(target, 'ArrowRight'); r.advance(3)
      check(`miniature ${tag} focus permits right-arrow paging`, r.book.turned === 3)
      key(target, 'ArrowLeft'); r.advance(3)
      check(`miniature ${tag} focus permits left-arrow paging`, r.book.turned === 2)
      dock.remove()
    }
    for (const cls of ['footnote-hit', 'inline-note-hit', 'inline-note-tag-hit']) {
      reset()
      const anchor = document.createElement('button'); anchor.dataset.ui = ''; anchor.className = cls; document.body.append(anchor)
      anchor.focus(); key(anchor, 'ArrowRight'); r.advance(3)
      check(`restored paper-button focus permits paging: ${cls}`, r.book.turned === 3)
      anchor.remove()
    }
    reset()
    key(document.body, 'ArrowRight', { isComposing: true })
    key(document.body, 'ArrowRight', { ctrlKey: true })
    const prevented = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }); prevented.preventDefault(); document.body.dispatchEvent(prevented)
    r.advance(3)
    check('composition, modifiers and handled keys do not navigate', r.book.turned === 2)
    reset()
    key(document.body, 'ArrowRight'); key(document.body, 'ArrowLeft'); window.dispatchEvent(new Event('blur')); r.advance(6)
    check('leaving window cancels deferred turns', r.book.turned === 3)
    reset()
    key(document.body, 'ArrowRight'); key(document.body, 'ArrowLeft')
    const input = document.createElement('textarea'); document.body.append(input); input.focus(); r.advance(6)
    check('entering editor cancels deferred turns', r.book.turned === 3); input.remove()
    reset()
    key(document.body, 'ArrowRight'); key(document.body, 'ArrowLeft'); r.suspendInteraction(true); r.suspendInteraction(false); r.advance(6)
    check('opening overlay cancels deferred turns', r.book.turned === 3)
    reset(); r.goToLeaf(0); r.advance(3)
    key(document.body, 'ArrowLeft'); r.advance(3)
    check('ArrowLeft at front closes book', !r.book.isOpen)
    key(document.body, 'ArrowRight'); key(document.body, 'ArrowRight'); r.advance(6)
    check('press during cover opening is retained', r.book.isOpen && r.book.turned === 1)
    return results
  })
  for (const result of results) console.log(result.ok ? 'PASS' : 'FAIL', result.name)
  assert.ok(results.every(r => r.ok), 'all keyboard navigation checks pass')
  // Real browser mouse events, then a real keyboard press, through scene input handlers.
  for (const dir of [1, -1]) {
    const point = await page.evaluate(() => {
      const r = window.__reader
      document.activeElement?.blur()
      r.setOpen(true); r.advance(3); r.goToLeaf(2); r.advance(3)
      const b = r.book
      return r.project(.94 * b.W + b.group.position.x, 0, b.stackTop(1))
    })
    await page.mouse.click(point.x, point.y)
    await page.evaluate(() => window.__reader.advance(.15))
    await page.keyboard.press(dir === 1 ? 'ArrowRight' : 'ArrowLeft')
    const state = await page.evaluate(() => {
      const r = window.__reader
      const started = r.book.turned, flyers = r.book.flyers.length
      r.advance(.70)
      return { started, flyers, settled: r.book.settledTurned, busy: r.book.busy }
    })
    assert.deepEqual(state, { started: dir === 1 ? 4 : 3, flyers: dir === 1 ? 2 : 1, settled: 3 + dir, busy: false })
    console.log('PASS real mouse click then keyboard preserves turn ordering', { dir })
  }
  assert.deepEqual(errors, [])
  console.log(`${results.length} keyboard checks passed`)
} finally { await browser.close() }
