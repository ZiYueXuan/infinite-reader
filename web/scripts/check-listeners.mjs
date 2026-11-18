// Listener-leak + console check. Instruments EventTarget.add/removeEventListener, drives the reader hard (open/close, key and
// mouse turns, drags, window blur / visibilitychange / contextmenu interrupts, resizes) and requires that the number of live
// listeners does not grow and that no console warning/error appears. Then disposes the scene and requires every listener it
// registered (window/document/canvas) to be gone.
//
// PUPPETEER_CORE=<puppeteer-core> READER_URL=http://localhost:5174/?sample=zh node scripts/check-listeners.mjs
// (needs `VITE_BACKEND=local npx vite --port 5174 --strictPort`).
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const browser = await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/local/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],defaultViewport:{width:1440,height:900}})
const page = await browser.newPage()
const logs = []
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()) })
page.on('pageerror', e => logs.push('pageerror: ' + e.message))
await page.evaluateOnNewDocument(`(()=>{
  const live=new Map(); let ids=new WeakMap(), n=0
  const id=t=>{let v=ids.get(t); if(!v){v=(t===window?'window':t===document?'document':(t.tagName||t.constructor.name))+'#'+(++n);ids.set(t,v)};return v}
  const key=(t,type,l,c)=>id(t)+'|'+type+'|'+(typeof l==='function'?l.toString().length+':'+(l.name||''):'obj')+'|'+(typeof c==='object'?!!c.capture:!!c)
  const add=EventTarget.prototype.addEventListener, rm=EventTarget.prototype.removeEventListener
  const set=new Map()
  EventTarget.prototype.addEventListener=function(type,l,c){ if(l){const o=typeof c==='object'&&c; if(!(o&&o.signal&&o.signal.aborted)){const k=this; let m=set.get(k); if(!m)set.set(k,m=new Map()); const kk=type+'|'+(typeof c==='object'?!!(c&&c.capture):!!c); let a=m.get(kk); if(!a)m.set(kk,a=new Set()); a.add(l); if(o&&o.signal) add.call(o.signal,'abort',()=>a.delete(l),{once:true})}} return add.call(this,type,l,c)}
  EventTarget.prototype.removeEventListener=function(type,l,c){ const m=set.get(this); if(m){const kk=type+'|'+(typeof c==='object'?!!(c&&c.capture):!!c); m.get(kk)?.delete(l)} return rm.call(this,type,l,c)}
  window.__lc=()=>{const out={}; for(const [t,m] of set){ if(t instanceof Node&&!t.isConnected&&t!==document)continue; for(const [kk,s] of m){ if(s.size){const k=(t===window?'window':t===document?'document':t instanceof AbortSignal?'AbortSignal':t.tagName||t.constructor.name)+' '+kk; out[k]=(out[k]||0)+s.size}}} return out}
})()`)
await page.goto(process.env.READER_URL || 'http://localhost:5174/?sample=zh',{waitUntil:'domcontentloaded'})
await page.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store',{timeout:120000})
await sleep(1500)
const R='window.__reader'
const snap=async()=>page.evaluate('window.__lc()')
const a=await snap()
for (let r=0;r<5;r++){
  for (let i=0;i<6;i++){ await page.evaluate(`${R}.setOpen(${i%2===0})`); await page.evaluate(`${R}.advance(2,1/60)`) }
  await page.evaluate(`${R}.setOpen(true)`); await page.evaluate(`${R}.advance(2,1/60)`)
  for (let i=0;i<8;i++){ await page.keyboard.press('ArrowRight'); await page.evaluate(`${R}.advance(1,1/60)`) }
  for (let i=0;i<8;i++){ await page.keyboard.press('ArrowLeft'); await page.evaluate(`${R}.advance(1,1/60)`) }
  for (let i=0;i<5;i++){ await page.mouse.move(900,450); await page.mouse.down(); await page.mouse.move(700,450,{steps:5}); await page.mouse.up(); await page.evaluate(`${R}.advance(1,1/60)`)
    await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange'))); await page.mouse.click(300,300,{button:'right'}) }
  await page.setViewport({width:1200+r*20,height:800})
}
const b = await snap()
const total = o => Object.values(o).reduce((x, y) => x + y, 0)
const diff = {}
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) diff[k] = [a[k] || 0, b[k] || 0]
console.log('live listeners before', total(a), 'after', total(b), 'diff', JSON.stringify(diff))
await page.evaluate(`${R}.dispose()`)
const c = await snap()
const sceneKeys = ['window pointermove|false', 'window pointerup|false', 'window pointercancel|false', 'window blur|false', 'window keydown|false',
  'window resize|false', 'window mousedown|true', 'window mouseup|true', 'document selectionchange|false', 'document visibilitychange|false']
const left = sceneKeys.filter(k => (c[k] || 0) >= (b[k] || 0))
console.log('after dispose: scene listener kinds not released:', JSON.stringify(left))
await browser.close()
let bad = 0
if (total(b) > total(a)) { console.log('FAIL listener count grew'); bad++ }
if (left.length) { console.log('FAIL listeners survive dispose'); bad++ }
if (logs.length) { console.log('FAIL console output:\n' + logs.join('\n')); bad++ }
if (bad) process.exit(1)
console.log('OK')
