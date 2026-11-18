// Rendered pixels, not just mesh positions: the gutter must not brighten at settlement.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 900 } })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5187/?sample=zh')
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  const result = await page.evaluate(async () => {
    const { BookModel } = await import('/src/engine/book.ts')
    const { BLANK_TEXTURE } = await import('/src/engine/paperMaterial.ts')
    const r = window.__reader
    r.paused = true; r.setOpen(true); r.advance(3)
    r.tex.onTextureReady = undefined; r.scene.remove(r.book.group)
    const b = new BookModel({ leafCount: 400, turned: 280, open: true, getTexture: () => BLANK_TEXTURE, cover: r.loaded.cover })
    r.book = b; r.scene.add(b.group); b.update(0)
    // Read the material's actual uniforms, including after Vite hot module reloads.
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' }
    b.pageSurface(-1).material.onBeforeCompile(shader, r.renderer)
    const shadowRig = shader.uniforms
    const cv = document.createElement('canvas'); cv.width = r.canvas.width; cv.height = r.canvas.height
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    const grab = () => { r.renderNow(); ctx.drawImage(r.canvas, 0, 0); return ctx.getImageData(0, 0, cv.width, cv.height).data }
    const compare = (a, c, gutter = false) => {
      const center = r.project(b.group.position.x, 0, b.profile(b.stackTop(-1), 0)), scale = cv.width / r.w
      const x0 = gutter ? Math.round(center.x * scale - 30) : 0, x1 = gutter ? x0 + 60 : cv.width
      const y0 = gutter ? Math.round(center.y * scale - 150) : 0, y1 = gutter ? y0 + 300 : cv.height
      let max = 0, changed = 0, total = 0, pixels = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = (y * cv.width + x) * 4
        const d = Math.max(Math.abs(a[p] - c[p]), Math.abs(a[p + 1] - c[p + 1]), Math.abs(a[p + 2] - c[p + 2]))
        max = Math.max(max, d); changed += +(d > 2); total += d; pixels++
      }
      return { max, changed, mean: total / pixels }
    }
    const cases = []
    for (const tilt of [.44, .9]) for (const direction of [1, -1]) {
      b.jumpTo(280); r.setTilt(tilt, false); r.advance(.3)
      b.turn(direction, 1, 'quick')
      for (let i = 0; i < 20; i++) b.update(1 / 120)
      const lit = grab(), n = shadowRig.uShN.value
      shadowRig.uShN.value = 0; const noShadow = grab(); shadowRig.uShN.value = n
      const during = compare(lit, noShadow)
      const fade = []
      for (let i = 20; i < 46; i++) { b.update(1 / 120); fade.push(shadowRig.uShOpacity.value[0]) }
      const before = grab()
      for (let i = 0; i < 6; i++) b.update(1 / 120)
      const after = grab()
      for (let i = 0; i < 120; i++) b.update(1 / 120)
      const later = grab()
      cases.push({ tilt, direction, during, boundary: compare(before, after, true), later: compare(after, later, true), fade,
        idle: shadowRig.uShN.value === 0 && [...shadowRig.uShOpacity.value].every(x => x === 0) })
    }
    b.jumpTo(280); b.turn(1, 1, 'quick')
    for (let i = 0; i < 30; i++) b.update(1 / 120)
    b.turn(1, 1, 'quick')
    for (let i = 0; i < 16; i++) b.update(1 / 120)
    const independent = b.flyers.map(f => ({ age: f.age, opacity: shadowRig.uShOpacity.value[f.mesh.uniforms.uShSelf.value] }))
    return { cases, independent }
  })
  for (const c of result.cases) {
    console.log(JSON.stringify(c))
    assert.ok(c.during.changed > 100, 'raised leaves still cast a visible dynamic shadow')
    assert.ok(c.fade.some(v => v > 0 && v < 1), 'landing shadow fades gradually')
    assert.ok(c.fade.every((v, i) => i === 0 || v <= c.fade[i - 1]), 'a single landing shadow does not brighten again')
    assert.equal(c.fade.at(-1), 0, 'dynamic shadow reaches zero before settlement')
    assert.ok(c.boundary.max <= 2 && c.boundary.mean < .05, 'no gutter brightness jump when the leaf settles')
    assert.equal(c.later.max, 0, 'gutter stays stable for the following second')
    assert.ok(c.idle, 'no dynamic shadow remains after settlement')
  }
  assert.equal(result.independent[0].opacity, 0, 'older landing leaf stops casting')
  assert.equal(result.independent[1].opacity, 1, 'younger raised leaf keeps its own shadow')
  assert.deepEqual(errors, [])
  console.log('PASS rendered shadow continuity, active shadows and independent overlapping leaves')
} finally { await browser.close() }
