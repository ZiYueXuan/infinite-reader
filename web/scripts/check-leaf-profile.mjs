// Page-turn leaf profile checks (v3: the curl profile is time-reversal symmetric about the vertical).
//
// 1. Numeric symmetry of the target profile (curlAngles): for every chord angle q the tangent profile at pi-q is the mirror image
//    of the one at q (theta(s; pi-q) = pi - theta(s; q)), for both turn directions; in the first half the sheet never passes the
//    vertical, in the second half it never comes back past it; each row is a single monotone arc; far rows never lead the hand row.
// 2. The same properties on the simulated leaf mesh during real turns: key, click-like and drag turns, forward and backward,
//    left and right pages (fold-over, creases = curvature sign flips along a row, rows beyond the hand row).
// 3. Optional frame sheets (SHEETS_DIR=/some/dir TAG=before|after): 12 frames of each turn at the default and an oblique tilt.
//
//   VITE_BACKEND=local npx vite --port 5174 --strictPort &
//   PUPPETEER_CORE=<puppeteer-core> [SHEETS_DIR=/tmp/pt3 TAG=after] node scripts/check-leaf-profile.mjs
// Exits non-zero on violations.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const BASE = process.env.READER_BASE || 'http://localhost:5174'
const SHEETS = process.env.SHEETS_DIR || ''
const TAG = process.env.TAG || 'run'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`${BASE}/?sample=zh`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store', { timeout: 120000 })
let fails = 0
const fail = (m) => { fails++; console.log('FAIL', m) }

/* ---------------------------- 1. numeric profile ---------------------------- */
const num = await page.evaluate(`(async()=>{
  const m = await import('/src/engine/leafSim.ts')
  const PI = Math.PI, out = { symErr: 0, foldFirst: 0, foldSecond: 0, nonMono: 0, rowLead: 0, rowNonMono: 0, mirrorSide: 0, tipBound: 0 }
  const theta = (q, side, vg, v, flex, s) => { const a = m.curlAngles(q, side, vg, v, flex, 0); return a.mid + a.delta * (2 * s - 1) }
  for (const side of [1, -1]) for (let i = 1; i < 200; i++) {
    const q = (i / 200) * PI
    for (const flex of [0, 0.1, 0.26, -0.12]) for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      // measured from the start side
      const phi = side === 1 ? q : PI - q
      const t1 = theta(phi, side, 0.5, 0.5, flex, s)
      const a1 = side === 1 ? t1 : PI - t1
      const phi2 = side === 1 ? PI - q : q
      const t2 = theta(phi2, side, 0.5, 0.5, flex, s)
      const a2 = side === 1 ? t2 : PI - t2
      // mirror about the vertical: start-side angle at pi-q equals pi minus the start-side angle at q
      out.symErr = Math.max(out.symErr, Math.abs(a2 - (PI - a1)))
    }
    // side mirror: same start-side profile for both turn directions
    for (const s of [0, 0.5, 1]) {
      const ta = theta(q, 1, 0.5, 0.2, 0.1, s), tb = theta(PI - q, -1, 0.5, 0.2, 0.1, s)
      out.mirrorSide = Math.max(out.mirrorSide, Math.abs(ta - (PI - tb)))
    }
    for (const flex of [0, 0.26, -0.12]) for (const vg of [0.1, 0.5, 0.9]) {
      let prevRow = null
      for (let r = 0; r < 8; r++) {
        const v = r / 7
        const a = m.curlAngles(q, 1, vg, v, flex, 0)
        const t0 = a.mid - a.delta, t1 = a.mid + a.delta
        if (a.mid < PI / 2 + 1e-9) { out.foldFirst = Math.max(out.foldFirst, t1 - PI / 2, t0 - PI / 2) }
        if (a.mid > PI / 2 - 1e-9) { out.foldSecond = Math.max(out.foldSecond, PI / 2 - t1, PI / 2 - t0) }
        out.tipBound = Math.max(out.tipBound, -t0, -t1, t0 - PI, t1 - PI)
        // one monotone arc: tangent angle is linear in arclength, so only the sign of delta matters; no sign flip inside a half
        if (a.mid < PI / 2 && a.delta < -1e-9) out.nonMono = Math.max(out.nonMono, -a.delta)
        if (a.mid > PI / 2 && a.delta > 1e-9) out.nonMono = Math.max(out.nonMono, a.delta)
        // rows never lead the hand row (start-side angle) and fall monotonically with distance from the hand
        const hand = m.curlAngles(q, 1, vg, vg, flex, 0).mid
        out.rowLead = Math.max(out.rowLead, a.mid - hand)
        if (prevRow !== null) { const dv = Math.abs(v - vg), pd = prevRow.dv; if (dv > pd + 1e-9 && a.mid > prevRow.mid + 1e-9) out.rowNonMono = Math.max(out.rowNonMono, a.mid - prevRow.mid) }
        prevRow = { dv: Math.abs(v - vg), mid: a.mid }
      }
    }
  }
  // the held point's x must fall monotonically with the chord angle (moveDrag bisects on it)
  out.reachNonMono = 0
  for (const u of [0.55, 0.8, 0.95]) for (const vg of [0.1, 0.5, 0.9]) {
    let prev = 1e9
    for (let i = 0; i <= 300; i++) { const x = m.curlReach((i / 300) * PI, 1, vg, u, 6.4).x; out.reachNonMono = Math.max(out.reachNonMono, x - prev); prev = x }
  }
  out.rowLag = m.ROW_LAG
  return out
})()`)
console.log('numeric profile:', JSON.stringify(num))
if (num.symErr > 1e-9) fail(`profile not mirror-symmetric about the vertical (max err ${num.symErr})`)
if (num.mirrorSide > 1e-9) fail(`forward and backward turns differ (${num.mirrorSide})`)
if (num.foldFirst > 1e-9) fail(`sheet passes the vertical during the first half (${num.foldFirst} rad)`)
if (num.foldSecond > 1e-9) fail(`sheet passes back over the vertical during the second half (${num.foldSecond} rad)`)
if (num.nonMono > 1e-9) fail(`curvature inverted against the half-turn convention (${num.nonMono})`)
if (num.tipBound > 1e-9) fail(`tangent leaves [0, pi] (${num.tipBound})`)
if (num.reachNonMono > 1e-9) fail(`hand reach is not monotone in the chord angle (${num.reachNonMono})`)
if (num.rowLead > 1e-9) fail(`a row leads the hand row (${num.rowLead})`)
if (num.rowNonMono > 1e-9) fail(`row angle not monotone in distance from the hand row (${num.rowNonMono})`)

/* ------------------------------- 2. sim turns ------------------------------- */
await page.evaluate('window.__reader.setOpen(true); window.__reader.advance(2.5)')
await sleep(800)
const prep = async () => {
  await page.evaluate('window.__reader.goToLeaf(2); window.__reader.advance(3)')
  await sleep(300)
  await page.evaluate('window.__reader.advance(0.2)')
}
const mk = `const mk=(t,x,y,b)=>new PointerEvent(t,{pointerId:9,clientX:x,clientY:y,button:0,buttons:b,bubbles:true,pointerType:'mouse',isPrimary:true});`
const pointer = (side, local) =>
  page.evaluate(`(()=>{const r=window.__reader,b=r.book;return r.project(${local}+b.group.position.x,0,b.stackTop(${side}))})()`)
const down = (p) => page.evaluate(`(()=>{${mk}document.querySelector('canvas').dispatchEvent(mk('pointerdown',${p.x},${p.y},1))})()`)
const move = (p, adv) => page.evaluate(`(()=>{${mk}window.dispatchEvent(mk('pointermove',${p.x},${p.y},1));const R=window.__reader;for(let i=0;i<${Math.round(adv*240)};i++)R.stepOnce(1/240)})()`)
const up = (p) => page.evaluate(`(()=>{${mk}const e=mk('pointerup',${p.x},${p.y},0);window.dispatchEvent(e);document.querySelector('canvas').dispatchEvent(e)})()`)
// per-frame metrics of the flying leaf(s) from the simulated nodes
const probe = `(()=>{const b=window.__reader.book,PI=Math.PI;const out=[];for(const f of b.flyers){const s=f.sim,N=s.N,R=s.R,fs=f.fromSide;
  const rows=[];let chordMean=0;
  for(let r=0;r<R;r++){const o=r*N;const th=[];for(let i=0;i<N-1;i++){let a=Math.atan2(s.z[o+i+1]-s.z[o+i],s.x[o+i+1]-s.x[o+i]);if(a<-PI/2)a+=2*PI;if(fs===-1)a=PI-a;th.push(a)}
    const cx=s.x[o+N-1]-s.x[o],cz=s.z[o+N-1]-s.z[o];let q=Math.atan2(cz,cx);if(q<-PI/2)q+=2*PI;if(fs===-1)q=PI-q;rows.push({th,q});chordMean+=q/R}
  out.push({k:f.k,mode:f.mode,fs,held:f.held,q:chordMean,v:f.v,rows})}return out})()`
const analyse = (fr, acc) => {
  for (const f of fr) {
    const q = f.q
    // only measure while the leaf is clearly away from both stacks
    if (q < 0.2 || q > Math.PI - 0.2) continue
    for (const row of f.rows) {
      const th = row.th
      const half1 = row.q < Math.PI / 2
      const hi = Math.max(...th), lo = Math.min(...th)
      // fold-over: part of the sheet past the vertical during the first half / short of it during the second half
      if (half1) acc.fold = Math.max(acc.fold, hi - Math.PI / 2)
      else acc.fold = Math.max(acc.fold, Math.PI / 2 - lo)
      // crease: curvature of a row changes sign inside the sheet by more than noise (counts total variation against the half-turn trend)
      let back = 0
      for (let i = 1; i < th.length; i++) {
        const d = th[i] - th[i - 1]
        const want = half1 ? 1 : -1
        if (d * want < 0) back += -d * want
      }
      acc.crease = Math.max(acc.crease, back)
      // sharpest bend between neighbouring segments
      for (let i = 1; i < th.length; i++) acc.kink = Math.max(acc.kink, Math.abs(th[i] - th[i - 1]))
    }
    // rows vs the hand row (nearest row to f.v)
    const R = f.rows.length, hr = Math.round(f.v * (R - 1))
    const mid = (r) => f.rows[r].th[Math.floor(f.rows[r].th.length * 0.55)]
    for (let r = 0; r < R; r++) acc.rowLead = Math.max(acc.rowLead, mid(r) - mid(hr))
    acc.frames++
  }
}
const run = async (name, drive) => {
  const acc = { fold: 0, crease: 0, kink: 0, rowLead: 0, frames: 0 }
  await drive(async (adv, n = 1) => {
    for (let i = 0; i < n; i++) {
      await page.evaluate(`(()=>{const R=window.__reader;for(let i=0;i<${Math.round(adv*240)};i++)R.stepOnce(1/240)})()`)
      analyse(await page.evaluate(probe), acc)
    }
  })
  console.log(`${name.padEnd(22)} frames=${acc.frames} fold=${acc.fold.toFixed(3)} crease=${acc.crease.toFixed(3)} kink=${acc.kink.toFixed(3)} rowLead=${acc.rowLead.toFixed(3)}`)
  const tolFold = +(process.env.TOL_FOLD || 0.08), tolCrease = +(process.env.TOL_CREASE || 0.15)
  if (acc.fold > tolFold) fail(`${name}: sheet folds past the vertical by ${acc.fold.toFixed(3)} rad`)
  if (acc.crease > tolCrease) fail(`${name}: row curvature reverses (crease ${acc.crease.toFixed(3)} rad)`)
  if (acc.kink > 0.25) fail(`${name}: sharp bend between neighbouring segments (${acc.kink.toFixed(3)} rad)`)
  if (acc.rowLead > 0.12) fail(`${name}: a row leads the hand row by ${acc.rowLead.toFixed(3)} rad`)
  if (!acc.frames) fail(`${name}: no frames measured`)
  await prep()
}
const settle = async () => { await page.evaluate('window.__reader.advance(3)'); await sleep(200) }
await prep()
for (const side of [1, -1]) {
  const tag = side === 1 ? 'fwd' : 'back'
  await run(`key ${tag}`, async (step) => {
    await page.evaluate(`window.__reader.turn(${side})`)
    await step(1 / 120, 140)
  })
  await run(`drag ${tag} mid`, async (step) => {
    const W = await page.evaluate('window.__reader.book.W')
    const d = W * 0.94
    await down(await pointer(side, side * d))
    for (let i = 1; i <= 24; i++) {
      await move(await pointer(side, side * d * (1 - (2 * i) / 24)), 0.02)
      await step(1 / 120, 3)
    }
    await up(await pointer(side, -side * d))
    await step(1 / 120, 120)
  })
  await run(`drag ${tag} corner`, async (step) => {
    const W = await page.evaluate('window.__reader.book.W')
    const d = W * 0.94
    const pc = await page.evaluate(`(()=>{const r=window.__reader,b=r.book;return r.project(${side}*${d}+b.group.position.x,b.H*0.46,0)})()`)
    await down(pc)
    for (let i = 1; i <= 24; i++) {
      const p = await pointer(side, side * d * (1 - (2 * i) / 24))
      await move({ x: p.x, y: pc.y }, 0.02)
      await step(1 / 120, 3)
    }
    await up(pc)
    await step(1 / 120, 120)
  })
  await run(`flick ${tag}`, async (step) => {
    const W = await page.evaluate('window.__reader.book.W')
    const d = W * 0.94
    const p0 = await pointer(side, side * d)
    await down(p0)
    for (let i = 1; i <= 4; i++) await move(await pointer(side, side * d * (1 - 0.5 * i / 4)), 0.01)
    await up(await pointer(side, side * d * 0.5))
    await step(1 / 120, 150)
  })
}

/* ------------------------------- 3. frame sheets ------------------------------ */
if (SHEETS) {
  const fs = await import('node:fs')
  fs.mkdirSync(SHEETS, { recursive: true })
  const shoot = async (name, i, clip) => {
    await page.evaluate('window.__reader.renderNow()')
    await page.screenshot({ path: `${SHEETS}/${TAG}-${name}-${i}.png`, clip })
  }
  const levels = Array.from({ length: 12 }, (_, i) => ((i + 0.7) / 12) * Math.PI)
  for (const [tname, tilt] of [['default', 0.44], ['oblique', 0.9]]) {
    await page.evaluate(`window.__reader.setTilt(${tilt},false); window.__reader.advance(0.2)`)
    await prep()
    const clip = await page.evaluate(`(()=>{const r=window.__reader,b=r.book,W=b.W,H=b.H,g=b.group.position.x;const pts=[];for(const x of [-W,W])for(const y of [-H/2,H/2])for(const z of [0,W*0.9])pts.push(r.project(g+x,y,z));
      const x0=Math.min(...pts.map(p=>p.x))-20,x1=Math.max(...pts.map(p=>p.x))+20,y0=Math.max(0,Math.min(...pts.map(p=>p.y))-20),y1=Math.max(...pts.map(p=>p.y))+20;return {x:Math.max(0,x0),y:y0,width:x1-x0,height:Math.min(900,y1)-y0}})()`)
    for (const side of [1, -1]) {
      const tag = side === 1 ? 'fwd' : 'back'
      // key turn: capture when the chord crosses each level
      await page.evaluate(`window.__reader.turn(${side})`)
      let li = 0
      for (let n = 0; n < 400 && li < levels.length; n++) {
        await page.evaluate('window.__reader.advance(1/240,1/240)')
        const q = await page.evaluate(`(()=>{const f=window.__reader.book.flyers[0];return f?(f.fromSide===1?f.phi:Math.PI-f.phi):9})()`)
        if (q >= levels[li]) await shoot(`key${tag}-${tname}`, li++, clip)
      }
      await prep()
      // drag turn: hold the pointer at positions that sweep the chord through each level
      const W = await page.evaluate('window.__reader.book.W')
      const d = W * 0.94
      await down(await pointer(side, side * d))
      for (let i = 0; i < levels.length; i++) {
        const x = side * d * (1 - (2 * levels[i]) / Math.PI)
        await move(await pointer(side, x), 0.02)
        await page.evaluate('window.__reader.advance(0.35,1/240)')
        await shoot(`drag${tag}-${tname}`, i, clip)
      }
      await up(await pointer(side, -side * d))
      await prep()
    }
  }
  await page.evaluate(`window.__reader.setTilt(0.44,false)`)
}
await browser.close()
if (fails) {
  console.log(`FAILED (${fails})`)
  process.exit(1)
}
console.log('PASS')
