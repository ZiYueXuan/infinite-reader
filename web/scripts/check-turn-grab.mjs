// Regression check for the "page underneath flashes on mouse-down" bug.
//
// Root cause: the hover / flutter peel belongs to the top resting leaf. When that leaf was lifted into a flyer
// (mouse grab, click or key turn) the peel stayed on BookModel and rebuildRest kept applying it to the new top leaf,
// i.e. the page underneath. Its lifted edge rose up to ~1 unit through the flat flyer for the first frames, so the
// covered page showed for a moment and then "switched back" once the flyer started to move.
//
// The check turns leaves while a peel is active (mouse grab + first move, click/key turn, turn mid-flutter, right and
// left pages) and asserts the leaf underneath never rises through the flying leaf (mesh geometry, per frame).
//
// Usage (needs a dev server in local mode and a Chrome):
//   VITE_BACKEND=local npx vite --port 5174 --strictPort &
//   PUPPETEER_CORE=<path to puppeteer-core> CHROME_BIN=/usr/local/bin/google-chrome node scripts/check-turn-grab.mjs
// Exits non-zero on failure.
//
// Second regression (live smoke test: book "visually closed and stuck"): a drag whose pointer-up never arrives (window blur,
// context menu / ctrl-click, a second press such as right-click) used to leave a held leaf or a held cover behind. A held
// cover left the book half-closed (psiHeld forever, store.open out of sync with the 3D state); a held leaf stayed
// in drag mode forever. The directed cases below interrupt cover and page drags in each way and assert the book ends in a
// consistent resting state. See also fuzz-pointer-sequences.mjs for randomized pointer sequences.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const URL = process.env.READER_URL || 'http://localhost:5174/?sample=zh'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store', { timeout: 120000 })
await page.evaluate('window.__reader.setOpen(true); window.__reader.advance(2.5)')
await sleep(800)
await page.evaluate('window.__reader.goToLeaf(2); window.__reader.advance(3)'); await sleep(500); await page.evaluate('window.__reader.advance(0.1)')
const mk=`const mk=(t,x,y,b)=>new PointerEvent(t,{pointerId:9,clientX:x,clientY:y,button:0,buttons:b,bubbles:true,pointerType:'mouse',isPrimary:true});`
const probe = `(()=>{const b=window.__reader.book; const out=[]; for(const f of b.flyers){ const F=f.mesh.mesh.geometry.attributes.position.array; let minGap=1e9, n=0, lift=0;
  for(const [k,lm] of b.used){ if(k===f.k) continue; if(b.flyers.some(q=>q.k===k)) continue; const U=lm.mesh.geometry.attributes.position.array;
    // only the leaf directly under the flyer: same stack side (x sign) and nearest height
    const sideOK = Math.sign(U[3*20])===Math.sign(F[3*20]) || Math.abs(F[3*20])<0.01; if(!sideOK) continue;
    for(let i=0;i<F.length;i+=3){ if(Math.abs(F[i]-U[i])<0.15 && Math.abs(F[i+1]-U[i+1])<1e-4){ minGap=Math.min(minGap,F[i+2]-U[i+2]); n++ } } }
  out.push({k:f.k,n,minGap:+minGap.toFixed(4)}) } return out})()`
let fails=0
const check = async (name, frames=[0,1/240,1/120,1/60,1/30,1/30]) => {
  for (const dt of frames) {
    if (dt) await page.evaluate(`window.__reader.advance(${dt},1/240)`)
    else await page.evaluate('window.__reader.renderNow()')
    const r = await page.evaluate(probe)
    for (const x of r) { if (x.n && x.minGap < 0.0015) { fails++; console.log('FAIL', name, 'dt', dt.toFixed(4), JSON.stringify(x)) } }
  }
  console.log(name, 'checked')
}
const settle = async()=>{ await page.evaluate('window.__reader.advance(3)'); await sleep(300); await page.evaluate('window.__reader.advance(0.1)') }
const edgePt = (side)=>page.evaluate(`(()=>{const r=window.__reader,b=r.book;return r.project(${side}*0.94*b.W+b.group.position.x,0,b.stackTop(${side}))})()`)
const down = async (p)=>page.evaluate(`(()=>{${mk}document.querySelector('canvas').dispatchEvent(mk('pointerdown',${p.x},${p.y},1))})()`)
const move = async (x,y,adv)=>page.evaluate(`(()=>{${mk}window.dispatchEvent(mk('pointermove',${x},${y},1));window.__reader.advance(${adv},1/240)})()`)
const up = async (x,y)=>page.evaluate(`(()=>{${mk}const e=mk('pointerup',${x},${y},0);window.dispatchEvent(e);document.querySelector('canvas').dispatchEvent(e)})()`)
for (const side of [1,-1]) {
  // hover peel -> mouse grab -> drag
  await page.evaluate(`window.__reader.book.setPeel(1,${side},0.5); window.__reader.advance(0.5)`)
  const p = await edgePt(side)
  await down(p); await check(`grab side=${side} (hover peel on)`)
  await move(p.x-side*6,p.y-3,1/60); await check(`first move side=${side}`,[1/60,1/60])
  await up(p.x-side*6,p.y-3); await settle()
  // hover peel -> click turn
  await page.evaluate(`window.__reader.book.setPeel(1,${side},0.3); window.__reader.advance(0.5)`)
  await page.evaluate(`window.__reader.turn(${side})`); await check(`key/click turn side=${side} (hover peel on)`)
  await settle()
  // peel mid-flutter (amplitude ramp) -> turn
  await page.evaluate(`window.__reader.book.setPeel(0.45,${side},0.25); window.__reader.advance(0.05)`)
  await page.evaluate(`window.__reader.turn(${side})`); await check(`turn mid-flutter side=${side}`)
  await settle()
  await page.evaluate(`window.__reader.goToLeaf(2); window.__reader.advance(3)`); await sleep(300)
}

// ---- interrupted drags: cover and page, every way the pointer-up can go missing ----
const state = () =>
  page.evaluate(`(()=>{const R=window.__reader,b=R.book;let bad=0;for(const v of b.st)if(v===2)bad++;
    return {psi:b.psi,target:b.psiTarget,held:b.psiHeld,heldLeaf:b.flyers.some(f=>f.held),flyers:b.flyers.length,stray:bad,
      nL:b.nL,nR:b.nR,N:b.N,isOpen:b.isOpen,storeOpen:window.__store.getState().open,drag:R.drag?R.drag.kind:null}})()`)
const expect = (name, cond, st) => {
  if (!cond) { fails++; console.log('FAIL', name, JSON.stringify(st)) }
}
const consistent = (name, st) => {
  expect(name + ': no held cover', !st.held, st)
  expect(name + ': no held leaf / flyers', !st.heldLeaf && st.flyers === 0 && st.stray === 0, st)
  expect(name + ': resting angle', Math.abs(st.psi - st.target) < 0.01 && (st.psi < 0.01 || st.psi > Math.PI - 0.01), st)
  expect(name + ': leaf counts', st.nL + st.nR === st.N, st)
  expect(name + ': store open matches book', st.storeOpen === st.isOpen, st)
}
const interrupt = async (how, x, y) => {
  if (how === 'blur') await page.evaluate('window.dispatchEvent(new Event("blur"))')
  if (how === 'contextmenu') await page.evaluate('document.querySelector("[data-ui]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))')
  if (how === 'canvas contextmenu') {
    // On the desk the menu is suppressed (right-drag tilts), so it must neither interrupt nor corrupt a left drag.
    const prevented = await page.evaluate('(()=>{const e=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});document.querySelector("canvas").dispatchEvent(e);return e.defaultPrevented})()')
    const live = await state()
    expect('canvas contextmenu is prevented', prevented, live)
    expect('canvas contextmenu leaves the left drag live', live.drag === 'page' || live.drag === 'cover', live)
    await page.evaluate(`(()=>{${mk}window.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,clientX:${x},clientY:${y},button:0,buttons:0,bubbles:true,pointerType:'mouse',isPrimary:true}))})()`)
  }
  if (how === 'second press') {
    // A right press is the tilt gesture now: it must leave a live left drag alone (no cancel, no tilt) and the
    // drag then ends through the normal pointer-up.
    await page.evaluate(`(()=>{${mk}document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,clientX:${x},clientY:${y},button:2,buttons:3,bubbles:true,pointerType:'mouse',isPrimary:true}))})()`)
    const live = await state()
    expect('second press (right) leaves the left drag live', live.drag === 'page' || live.drag === 'cover', live)
    await page.evaluate(`(()=>{${mk}window.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,clientX:${x},clientY:${y},button:0,buttons:0,bubbles:true,pointerType:'mouse',isPrimary:true}))})()`)
  }
  if (how === 'pointercancel') await page.evaluate(`(()=>{${mk}window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:9,clientX:${x},clientY:${y},bubbles:true,pointerType:'mouse',isPrimary:true}))})()`)
  if (how === 'visibility hidden') await page.evaluate('Object.defineProperty(document,"visibilityState",{value:"hidden",configurable:true});document.dispatchEvent(new Event("visibilitychange"));Object.defineProperty(document,"visibilityState",{value:"visible",configurable:true})')
}
const projectAt = (side, u, v) => page.evaluate(`(()=>{const r=window.__reader,b=r.book;return r.project(${side}*${u}*b.W+b.group.position.x,(${v}-0.5)*b.H,b.stackTop(${side}))})()`)
const reset = async (leaf) => {
  await page.evaluate(`(()=>{const R=window.__reader;R.drag=null;R.goToLeaf(${leaf});R.advance(3);R.setOpen(true);R.advance(3)})()`)
  await sleep(300)
}
for (const how of ['blur', 'contextmenu', 'canvas contextmenu', 'second press', 'pointercancel', 'visibility hidden']) {
  // cover drag from the left page of the first spread, partial and long moves
  for (const reach of [0.9, 0.35, -0.2]) {
    await reset(0)
    const p = await projectAt(-1, 0.93, 0.5)
    await page.evaluate(`(()=>{${mk}document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,clientX:${p.x},clientY:${p.y},button:0,buttons:1,bubbles:true,pointerType:'mouse',isPrimary:true}))})()`)
    const q = await projectAt(1, reach, 0.5)
    for (let i = 1; i <= 6; i++)
      await page.evaluate(`(()=>{${mk}window.dispatchEvent(new PointerEvent('pointermove',{pointerId:9,clientX:${p.x + ((q.x - p.x) * i) / 6},clientY:${p.y},buttons:1,bubbles:true,pointerType:'mouse',isPrimary:true}));window.__reader.advance(0.03,1/120)})()`)
    await interrupt(how, q.x, p.y)
    await page.evaluate('window.__reader.advance(3,1/60)')
    const st = await state()
    consistent(`cover drag reach=${reach} interrupted by ${how}`, st)
    await page.evaluate('window.__reader.drag=null')
    if (st.psi < 0.01) {
      await page.evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));window.__reader.advance(3,1/60)')
      const st2 = await state()
      expect(`cover drag reach=${reach} (${how}): ArrowRight reopens the book`, st2.psi > Math.PI - 0.01 && st2.isOpen && st2.storeOpen, st2)
    }
  }
  // page drag on a middle spread, interrupted while the leaf is held
  for (const side of [1, -1]) {
    await reset(3)
    const p = await projectAt(side, 0.94, 0.5)
    await page.evaluate(`(()=>{${mk}document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,clientX:${p.x},clientY:${p.y},button:0,buttons:1,bubbles:true,pointerType:'mouse',isPrimary:true}))})()`)
    for (let i = 1; i <= 5; i++)
      await page.evaluate(`(()=>{${mk}window.dispatchEvent(new PointerEvent('pointermove',{pointerId:9,clientX:${p.x - side * 40 * i},clientY:${p.y - 6 * i},buttons:1,bubbles:true,pointerType:'mouse',isPrimary:true}));window.__reader.advance(0.03,1/120)})()`)
    await interrupt(how, p.x, p.y)
    await page.evaluate('window.__reader.advance(4,1/60)')
    const st = await state()
    consistent(`page drag side=${side} interrupted by ${how}`, st)
    await page.evaluate('window.__reader.drag=null')
  }
}
// a second press on top of a live drag must not orphan the first held leaf
await reset(3)
for (const side of [1, -1]) {
  const p = await projectAt(side, 0.94, 0.5)
  for (let k = 0; k < 3; k++)
    await page.evaluate(`(()=>{${mk}document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,clientX:${p.x},clientY:${p.y},button:0,buttons:1,bubbles:true,pointerType:'mouse',isPrimary:true}));window.__reader.advance(0.05,1/120)})()`)
  await page.evaluate(`(()=>{${mk}window.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,clientX:${p.x},clientY:${p.y},buttons:0,bubbles:true,pointerType:'mouse',isPrimary:true}))})()`)
  await page.evaluate('window.__reader.advance(4,1/60)')
  consistent(`three presses without pointer-up, side=${side}`, await state())
  await reset(3)
}
console.log(fails? `FAILED (${fails} violations)` : 'PASS')
await browser.close()
process.exit(fails?1:0)
