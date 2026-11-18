// Randomized pointer-sequence stress test for the 3D book (drag / cancel / click / key / selection near edges, rapid
// down/up, pointercancel, contextmenu, right-button press, window blur, left and right pages, first and last leaves).
// After every sequence the pointer is released and the book must be in a consistent resting state: no flyers or held
// leaves, no held/half-open cover, psi at 0 or PI, leaf counts matching the stacks, store.open matching the 3D state.
//
// SEED=1 SEQS=40 LEN=14 PUPPETEER_CORE=<puppeteer-core> node scripts/fuzz-pointer-sequences.mjs
// (needs `VITE_BACKEND=local npx vite --port 5174 --strictPort`). Exits non-zero on any violation or console error.
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const SEED=+(process.env.SEED||1), SEQS=+(process.env.SEQS||40), LEN=+(process.env.LEN||14)
let s=SEED>>>0; const rnd=()=>{s=(s*1664525+1013904223)>>>0; return s/4294967296}
const pick=a=>a[Math.floor(rnd()*a.length)]
const browser = await puppeteer.launch({executablePath:process.env.CHROME_BIN||'/usr/local/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],defaultViewport:{width:1440,height:900}})
const page = await browser.newPage()
const logs=[]
page.on('console',m=>{ if(['error','warning'].includes(m.type())) logs.push(m.type()+': '+m.text()) })
page.on('pageerror',e=>logs.push('pageerror: '+e.message))
await page.goto(`${process.env.READER_URL||'http://localhost:5174/?sample=zh'}`,{waitUntil:'domcontentloaded'})
await page.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store',{timeout:120000})
await page.evaluate(`(()=>{
  const real=performance.now.bind(performance); let fake=real(); performance.now=()=>fake; window.__tick=ms=>{fake+=ms}
  const R=window.__reader, cv=document.querySelector('canvas')
  const mk=(t,id,x,y,b,btn)=>new PointerEvent(t,{pointerId:id,clientX:x,clientY:y,button:btn||0,buttons:b,bubbles:true,pointerType:'mouse',isPrimary:id===1})
  window.__A={
    pt:(side,u,v,lift)=>{const b=R.book;return R.project(side*u*b.W+b.group.position.x,(v-0.5)*b.H,b.stackTop(side>0?1:-1)+(lift||0))},
    down:(id,x,y)=>cv.dispatchEvent(mk('pointerdown',id,x,y,1)),
    rdown:(id,x,y)=>cv.dispatchEvent(mk('pointerdown',id,x,y,3,2)),
    ctx:()=>document.querySelector('[data-ui]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})),
    ctxCanvas:()=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});cv.dispatchEvent(e);return e.defaultPrevented},
    altdown:(id,x,y)=>cv.dispatchEvent(new PointerEvent('pointerdown',{pointerId:id,clientX:x,clientY:y,button:0,buttons:1,altKey:true,bubbles:true,pointerType:'mouse',isPrimary:id===1})),
    move:(id,x,y)=>window.dispatchEvent(mk('pointermove',id,x,y,1)),
    up:(id,x,y)=>{const e=mk('pointerup',id,x,y,0);window.dispatchEvent(e)},
    cancel:(id,x,y)=>{window.dispatchEvent(mk('pointercancel',id,x,y,0))},
    key:(k,sh)=>window.dispatchEvent(new KeyboardEvent('keydown',{key:k,shiftKey:!!sh,bubbles:true})),
    blur:()=>window.dispatchEvent(new Event('blur')),
    state:()=>{const b=R.book;let n0=0,n1=0,n2=0;for(const v of b.st){if(v===0)n0++;else if(v===1)n1++;else n2++}
      return {psi:+b.psi.toFixed(3),psiTarget:+b.psiTarget.toFixed(3),psiHeld:b.psiHeld,flyers:b.flyers.length,held:b.flyers.filter(f=>f.held).length,modes:b.flyers.map(f=>f.mode).join(','),nL:b.nL,nR:b.nR,N:b.N,n0,n1,n2,drag:R.drag?R.drag.kind:null,tilt:R.debugTilt,storeOpen:window.__store.getState().open,isOpen:b.isOpen,used:b.used.size,visUsed:[...b.used.values()].filter(l=>l.mesh.visible).length}}
  }
})()`)
const adv=(t,st=1/60)=>page.evaluate(`window.__reader.advance(${t},${st})`)
const A=(code)=>page.evaluate(code)
await A('window.__reader.setOpen(true)'); await adv(3); await sleep(1500); await adv(0.2)
const hist=[]; let bad=0
const check=(label,st,final)=>{
  const errs=[]
  if(final){
    if(st.flyers) errs.push('flyers remain '+st.flyers+' modes='+st.modes)
    if(st.psiHeld) errs.push('psiHeld stuck')
    if(!(Math.abs(st.psi-st.psiTarget)<0.01)) errs.push('psi!=target')
    if(!(st.psi<0.01||st.psi>3.13)) errs.push('psi not settled '+st.psi)
    if(st.drag) errs.push('drag state stuck '+st.drag)
    if(st.psiTarget>0.01&&st.psiTarget<3.13) errs.push('psiTarget half-open '+st.psiTarget)
    if(st.storeOpen!==st.isOpen) errs.push(`store.open=${st.storeOpen} book.isOpen=${st.isOpen}`)
  }
  if(!(st.tilt>=0&&st.tilt<=1.0801)) errs.push('tilt out of range '+st.tilt)
  if(st.n2!==st.flyers) errs.push(`st==2 count ${st.n2} != flyers ${st.flyers}`)
  if(st.nL!==st.n1||st.nR!==st.n0) errs.push(`nL/nR ${st.nL}/${st.nR} vs st ${st.n1}/${st.n0}`)
  return errs
}
for(let q=0;q<SEQS;q++){
  const seq=[]
  await A(`window.__reader.book.flyers.length===0&&window.__reader.goToLeaf(${Math.floor(rnd()*(await A('window.__reader.book.N')+1))})`)
  await A('window.__reader.setOpen(true)'); await adv(3); await adv(0.1)
  const startSt=await A('window.__A.state()')
  if(startSt.flyers||startSt.psiHeld||startSt.psiTarget<3.13){ console.log('  (carry-over state, resetting)'); await A('(()=>{const b=window.__reader.book;b.jumpTo(0);b.psiHeld=false;b.psiTarget=Math.PI;b.psi=Math.PI;window.__reader.drag=null})()'); await adv(0.5) }
  let down=null, ids=new Set()
  for(let i=0;i<LEN;i++){
    const kind=pick(['down','down','move','move','up','cancel','blur','key','key','click','adv','adv','down2','hover','sel','rdown','ctx','ctxCanvas','altdown','rdown','move'])
    const side=pick([1,-1])
    const zone=pick(['edge','edge','corner','text','cover','spine','outside'])
    const u= zone==='edge'?0.78+rnd()*0.25: zone==='corner'?0.9+rnd()*0.1: zone==='text'?0.1+rnd()*0.55: zone==='cover'?1.0+rnd()*0.08: zone==='spine'?rnd()*0.08:1.2
    const v= zone==='corner'?pick([0.03,0.97]):rnd()
    let desc=''
    if(kind==='down'||kind==='down2'){
      const p=await A(`window.__A.pt(${side},${u},${v},0)`); const id=kind==='down2'?2:1
      desc=`down id${id} s${side} ${zone} u${u.toFixed(2)} v${v.toFixed(2)}`; await A(`window.__A.down(${id},${p.x},${p.y})`); down={id,x:p.x,y:p.y,side}; ids.add(id)
    } else if(kind==='move'&&down){
      const f=rnd()*1.4; const dx=-down.side*(rnd()<0.8? f:-f*0.3)*260, dy=(rnd()-0.5)*160
      down.x+=dx; down.y+=dy; desc=`move ${dx.toFixed(0)},${dy.toFixed(0)}`; await A(`window.__A.move(${down.id},${down.x},${down.y})`); await adv(0.03,1/120)
    } else if(kind==='up'&&down){ desc='up'; await A(`window.__tick(${pick([5,50,400])});window.__A.up(${down.id},${down.x},${down.y})`); ids.delete(down.id); down=null }
    else if(kind==='cancel'&&down){ desc='pointercancel'; await A(`window.__A.cancel(${down.id},${down.x},${down.y})`); ids.delete(down.id); down=null }
    else if(kind==='rdown'){ const p=await A(`window.__A.pt(${side},${u},${v},0)`); desc=`right-button down ${zone}`; await A(`window.__A.rdown(1,${p.x},${p.y})`); if(!down){ down={id:1,x:p.x,y:p.y,side}; ids.add(1) } }
    else if(kind==='altdown'){ const p=await A(`window.__A.pt(${side},${u},${v},0)`); desc=`alt+left down ${zone}`; await A(`window.__A.altdown(1,${p.x},${p.y})`); if(!down){ down={id:1,x:p.x,y:p.y,side}; ids.add(1) } }
    else if(kind==='ctxCanvas'){ desc='contextmenu on canvas (must be prevented, must not end a drag)'; const pr=await A('window.__A.ctxCanvas()'); if(!pr){ bad++; console.log(`SEQ ${q} contextmenu on the canvas was not prevented`) } }
    else if(kind==='ctx'){ desc='contextmenu (pointerup lost)'; await A('window.__A.ctx()'); down=null }
    else if(kind==='blur'){ desc='blur'; await A('window.__A.blur()') }
    else if(kind==='key'){ const k=pick(['ArrowRight','ArrowLeft','ArrowRight','ArrowLeft',' ','Home','End','PageDown']); desc='key '+k; await A(`window.__A.key(${JSON.stringify(k)})`); await adv(pick([0.02,0.1,0.4]),1/60) }
    else if(kind==='click'){ const p=await A(`window.__A.pt(${side},${u},${v},0)`); desc=`click s${side} ${zone} u${u.toFixed(2)} v${v.toFixed(2)}`; await A(`window.__A.down(3,${p.x},${p.y});window.__tick(30);window.__A.up(3,${p.x},${p.y})`) ; await adv(pick([0.01,0.2,1]),1/60)}
    else if(kind==='adv'){ const t=pick([0.016,0.05,0.2,0.6]); desc='adv '+t; await adv(t,1/120) }
    else if(kind==='hover'){ const p=await A(`window.__A.pt(${side},${u},${v},0)`); desc=`hover ${zone}`; await A(`window.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:${p.x},clientY:${p.y},buttons:0,bubbles:true,pointerType:'mouse'}));document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:${p.x},clientY:${p.y},buttons:0,bubbles:true,pointerType:'mouse'}))`); await adv(0.1,1/60) }
    else if(kind==='sel'){ const p=await A(`window.__A.pt(${side},${u},${v},0)`); desc='selection mouse events'; await A(`(()=>{const t=document.elementFromPoint(${p.x},${p.y}); const o={clientX:${p.x},clientY:${p.y},bubbles:true,button:0}; (t||document.body).dispatchEvent(new MouseEvent('mousedown',o)); window.dispatchEvent(new MouseEvent('mouseup',o))})()`) }
    else continue
    seq.push(desc)
    const st=await A('window.__A.state()'); const errs=check(desc,st,false)
    if(errs.length){ bad++; console.log(`SEQ ${q} step ${i} VIOLATION`,errs.join('; '),'\n  after:',seq.join(' | '),'\n  state',JSON.stringify(st)); break }
  }
  // release everything, settle
  for(const id of [1,2,3]){ await A(`window.__A.up(${id},0,0)`) }
  await adv(4); await adv(0.2)
  const st=await A('window.__A.state()'); const errs=check('final',st,true)
  if(errs.length){ bad++; console.log(`SEQ ${q} FINAL VIOLATION`,errs.join('; '),'\n  start',JSON.stringify(startSt),'\n  seq:',seq.join(' | '),'\n  state',JSON.stringify(st)) }
}
console.log('done seed',SEED,'bad',bad,'console logs',JSON.stringify(logs.slice(0,10)))
await browser.close()
process.exit(bad||logs.length?1:0)
