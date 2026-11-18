// Regression check for the shadows cast during a page turn (key turn, default and oblique tilt).
//
//   READER_BASE=http://localhost:5174 node scripts/check-turn-shadow.mjs
//   SHEETS_DIR=/tmp/shots TAG=after node scripts/check-turn-shadow.mjs   # also writes frames + metrics.json
//
// Per instant it renders the same frame four ways (normal / flyer casting no map shadow / flyer hidden with the
// analytic page shadow off / flyer flat green for a coverage mask) and measures relative luminance:
//   page  = lit page pixels outside the leaf, normal vs flyer hidden (shadow the leaf throws on the page)
//   leaf  = the leaf's own face against the lit page (self shading, curl and hinge darkening)
//   desk  = darkest desk pixel below the book, normal vs flyer not casting (shadow-map shadow)
// Targets: soft low-contrast shadow, <=30% at the darkest page core, desk shadow never near black, leaf face
// within ~15% of the page, and no page shadow at all when nothing is in flight.
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const BASE = process.env.READER_BASE || 'http://localhost:5174'
const SHEETS = process.env.SHEETS_DIR || ''
const TAG = process.env.TAG || 'run'
const MAX_PAGE_SHADOW = +(process.env.MAX_PAGE_SHADOW || 0.3)
const MAX_DESK_SHADOW = +(process.env.MAX_DESK_SHADOW || 0.75)
const MIN_LEAF_MEDIAN = +(process.env.MIN_LEAF_MEDIAN || 0.84)
const MIN_DESK_EDGE_PX = +(process.env.MIN_DESK_EDGE_PX || 30)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = SHEETS ? await import('node:fs') : null
if (fs) fs.mkdirSync(SHEETS, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
let fails = 0
const check = (ok, msg) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`)
}
page.on('pageerror', (e) => check(false, `pageerror ${e.message}`))
await page.goto(`${BASE}/?sample=zh`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store', { timeout: 120000 })
await page.evaluate('window.__reader.setOpen(true); window.__reader.advance(2.5)')
await sleep(800)

const FR = [0.15, 0.25, 0.35, 0.45, 0.5, 0.55, 0.65, 0.75, 0.85]
const all = {}
for (const [tn, tilt] of [['default', 0.44], ['oblique', 0.9]]) {
  await page.evaluate(`window.__reader.setTilt(${tilt},false); window.__reader.advance(0.2)`)
  await page.evaluate('window.__reader.goToLeaf(2); window.__reader.advance(3)')
  await sleep(300)
  await page.evaluate('window.__reader.advance(0.2)')
  const out = await page.evaluate(`(()=>{
    const R=window.__reader,b=R.book,FR=${JSON.stringify(FR)}
    const lin=c=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
    const L=(d,i)=>0.2126*lin(d[i])+0.7152*lin(d[i+1])+0.0722*lin(d[i+2])
    const grab=()=>{R.renderNow();const cv=R.canvas;const c=document.createElement('canvas');c.width=cv.width;c.height=cv.height;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(cv,0,0);return {d:g.getImageData(0,0,cv.width,cv.height).data,w:cv.width,h:cv.height,c}}
    const dpr=R.canvas.width/R.canvas.clientWidth
    const results=[]
    R.turn(1)
    let li=0
    for(let n=0;n<600&&li<FR.length;n++){
      R.advance(1/240,1/240)
      const f=b.flyers[0]; if(!f) break
      const q=f.fromSide===1?f.phi:Math.PI-f.phi
      if(q<FR[li]*Math.PI) continue
      li++
      const lm=f.mesh.mesh
      const A=grab()
      lm.castShadow=false; const C=grab(); lm.castShadow=true
      const rec=[...b.used.values()].map(x=>[x,x.uniforms.uShRecv?.value])
      rec.forEach(([x])=>{if(x.uniforms.uShRecv)x.uniforms.uShRecv.value=0})
      lm.visible=false; const V=grab(); lm.visible=true
      rec.forEach(([x,v])=>{if(x.uniforms.uShRecv)x.uniforms.uShRecv.value=v})
      const mat=lm.material
      lm.material=new mat.constructor({color:0x000000,emissive:0x00ff00,side:2})
      const K=grab()
      lm.material.dispose(); lm.material=mat
      const leaf=new Uint8Array(A.w*A.h); const lv=[]
      for(let p=0;p<A.w*A.h;p++){const i=p*4;if(K.d[i+1]-K.d[i]>100){leaf[p]=1;lv.push(L(A.d,i))}}
      lv.sort((x,y)=>x-y)
      const zt=b.stackTop(1)
      const patch=(px,py,r)=>{let a=0,v=0,n=0;for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++){const X=Math.round(px*dpr)+x,Y=Math.round(py*dpr)+y;if(X<0||Y<0||X>=A.w||Y>=A.h)return null;const p=Y*A.w+X;if(leaf[p])return null;a+=L(A.d,p*4);v+=L(V.d,p*4);n++}return {A:a/n,V:v/n}}
      let pageMin=1,ref=null
      for(const fu of [0.02,0.05,0.1,0.18,0.3,0.45,0.6,0.8,0.92])for(const fv of [-0.3,0,0.3]){const s=R.project(fu*b.W+b.group.position.x,fv*b.H,zt);const p=patch(s.x,s.y,4);if(p){pageMin=Math.min(pageMin,p.A/p.V);if(fu===0.6&&fv===0)ref=p.V}}
      let dmin=1,dx=0,dy=0
      for(let y=Math.round(A.h*0.8);y<A.h;y++)for(let x=0;x<A.w;x++){const p=y*A.w+x;const c=L(C.d,p*4);if(c<0.02)continue;const r=L(A.d,p*4)/c;if(r<dmin){dmin=r;dx=x;dy=y}}
      let edgePx=null
      if(dmin<0.95){const lo=dmin+0.1*(1-dmin),hi=dmin+0.9*(1-dmin);let best=0
        for(const dir of [1,-1]){let a=-1,bb=-1;for(let k=0;k<260;k++){const x=dx+dir*k;if(x<0||x>=A.w)break;const p=dy*A.w+x;const c=L(C.d,p*4);const r=c>0.02?L(A.d,p*4)/c:1;if(a<0&&r>=lo)a=k;if(bb<0&&r>=hi){bb=k;break}}if(a>=0&&bb>a)best=Math.max(best,bb-a)}
        edgePx=best}
      results.push({q:q/Math.PI,pageShadow:1-pageMin,leafMedian:ref&&lv.length?lv[Math.floor(lv.length/2)]/ref:null,leafP10:ref&&lv.length?lv[Math.floor(lv.length*0.1)]/ref:null,deskShadow:1-dmin,deskEdgePx:edgePx,url:A.c.toDataURL('image/png')})
    }
    return results
  })()`)
  all[tn] = out.map((o, i) => {
    if (fs) fs.writeFileSync(`${SHEETS}/${TAG}-${tn}-${i}.png`, Buffer.from(o.url.split(',')[1], 'base64'))
    delete o.url
    return o
  })
  for (const o of all[tn]) {
    const tag = `${tn} q=${o.q.toFixed(2)}pi`
    check(o.pageShadow <= MAX_PAGE_SHADOW, `${tag} page shadow core ${(o.pageShadow * 100).toFixed(0)}% <= ${MAX_PAGE_SHADOW * 100}%`)
    check(o.deskShadow <= MAX_DESK_SHADOW, `${tag} desk shadow core ${(o.deskShadow * 100).toFixed(0)}% <= ${MAX_DESK_SHADOW * 100}%`)
    if (o.leafMedian != null && o.q >= 0.3 && o.q <= 0.7) check(o.leafMedian >= MIN_LEAF_MEDIAN, `${tag} leaf face median ${o.leafMedian.toFixed(2)} of lit page >= ${MIN_LEAF_MEDIAN}`)
    if (o.deskEdgePx != null && o.q >= 0.3) check(o.deskEdgePx >= MIN_DESK_EDGE_PX, `${tag} desk shadow 10-90% edge ${o.deskEdgePx}px >= ${MIN_DESK_EDGE_PX}px`)
  }
  await page.evaluate('window.__reader.advance(3)')
}
const idle = await page.evaluate(`(()=>{const R=window.__reader,b=R.book;R.advance(2);return [...b.used.values()].every(x=>!x.uniforms.uShRecv||x.uniforms.uShRecv.value===0)&&!b.flyers.length})()`)
check(idle, 'no page shadow state left behind once the turn has settled')
if (SHEETS) fs.writeFileSync(`${SHEETS}/${TAG}-metrics.json`, JSON.stringify(all, null, 1))
await browser.close()
if (fails) {
  console.log(`FAILED (${fails})`)
  process.exit(1)
}
console.log('PASS')
