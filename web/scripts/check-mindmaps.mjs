// Real TOC/dialog, intercepted API fixtures only: no paid requests or real user data.
import assert from 'node:assert/strict'
import { checkMindmapConnections } from './mindmap-connection-helpers.mjs'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } })
const page = await browser.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
page.setDefaultTimeout(30000)
await page.evaluateOnNewDocument(() => localStorage.setItem('ir:locale', 'zh-CN'))
const bookId = '11111111-1111-4111-8111-111111111111'
let saved = null, posts = 0, reads = 0
const tree = { text: '第一章 Token 的成本结构', children: [
  { text: '能源成本', children: [{ text: '电力与冷却', children: [] }, { text: '规模与效率', children: [] }] },
  { text: '芯片与基础设施', children: [{ text: 'GPU / HBM / 网络', children: [] }, { text: '机房、供电与液冷', children: [] }] },
  { text: '模型与应用', children: [{ text: '训练摊销和推理优化', children: [] }, { text: '界面、集成与合规', children: [] }] },
  { text: '<img src=x onerror="window.unsafe=true">', children: [] },
] }
await page.setRequestInterception(true)
page.on('request', req => {
  const url = new URL(req.url()), json = (body, status=200) => req.respond({ status, contentType:'application/json', body:JSON.stringify(body) })
  if (!url.pathname.startsWith('/api/')) return void req.continue()
  if (url.pathname === '/api/auth/me') return void json({ user:{id:'mindmap-user',email:'test@example.com',name:null,avatar_url:null} })
  if (url.pathname === '/api/books') return void json({ books:[] })
  if (url.pathname.endsWith('/mindmaps')) return void json({readyTargets: saved ? ['chapter.xhtml','chapter.xhtml#s2'] : ['chapter.xhtml#s2'], pending:false})
  if (url.pathname.endsWith('/mindmap')) {
    if (req.method() === 'GET') { reads++; return void json(saved ? {status:'ready',result:saved,cached:true} : {status:'missing'}) }
    posts++
    saved = {tree,title:tree.text,model:'deepseek-flash',operationId:'test-op',generatedAt:Date.now()}
    return void setTimeout(() => json({status:'ready',result:saved,cached:false}), 300)
  }
  if (url.pathname === '/api/costs') return void json({error:{code:'fixture',message:'No costs fixture'}},503)
  return void json({ok:true})
})
const check = (value, label) => { assert.ok(value,label); console.log('PASS',label) }
async function openFixture() {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5173/shelf', {waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => window.__store?.getState().session.status === 'user')
  await page.evaluate(bookId => {
    const text = '用于检验思维导图的正文。'.repeat(50)
    const current = {meta:{id:bookId,title:'Token 经济',author:'Test',language:'zh',addedAt:Date.now(),status:'ready'},parsed:{meta:{title:'Token 经济',author:'Test',language:'zh'},chapters:[{index:0,title:'第一章',href:'chapter.xhtml',textLength:text.length,blocks:[{kind:'p',text,start:0,runs:[{text}]}]}],toc:[{title:'第一章 Token 的成本结构',chapter:0,level:0,href:'chapter.xhtml'},{title:'第一节 能源与硬件',chapter:0,level:1,href:'chapter.xhtml#s1'},{title:'第二章 应用和基础设施',chapter:0,level:0,href:'chapter.xhtml#s2'}],getImage:async()=>null}}
    window.__store.setState({current,loading:null,showLogin:false,panel:'toc'})
    window.__store.getState().goToToc = () => { window.__navigated = true }
  }, bookId)
  await page.waitForSelector('.toc-mindmap')
}
try {
  await openFixture()
  check(await page.$$eval('.toc-mindmap', e => e.length === 3), 'chapter and section rows have individual map buttons')
  await page.waitForSelector('.toc-mindmap.is-ready')
  check(await page.$$eval('.toc-mindmap', els => !els[0].classList.contains('is-ready') && !els[1].classList.contains('is-ready') && els[2].classList.contains('is-ready') && !!els[2].querySelector('.toc-mindmap-check')), 'saved cloud map has a distinct checked icon before opening it')
  check(posts === 0, 'TOC status read does not generate maps')
  await page.screenshot({path:'/tmp/mindmap-toc.png'})
  await page.click('.toc-mindmap')
  await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts === 1, 'first click invokes exactly one generation')
  check(await page.$eval('.mindmap-dialog', e => {const r=e.getBoundingClientRect();return Math.abs(r.x)<1&&Math.abs(r.y)<1&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1}), 'mind map fills the entire desktop reading area by default')
  check(await page.evaluate(() => !window.__navigated), 'map button does not navigate or turn a page')
  check(await page.evaluate(() => !window.unsafe && !document.querySelector('.mindmap-tree img')), 'model labels are inert text')
  const before = await page.$$eval('.mindmap-node', e => e.length)
  await page.click('.mindmap-root > .mindmap-node')
  check(await page.$$eval('.mindmap-node', e => e.length === 1), 'root collapses all branches')
  await page.click('.mindmap-root > .mindmap-node')
  check(await page.$$eval('.mindmap-node', e => e.length) === before, 'branches expand again')
  await page.click('.mindmap-bulk button:last-child')
  check(await page.$$eval('.mindmap-node', e => e.length === 1), 'collapse all leaves only the root visible')
  await page.click('.mindmap-root > .mindmap-node')
  check(await page.$$eval('.mindmap-node', e => e.length === 5), 'manual expansion after collapse-all keeps deeper branches collapsed')
  await page.click('.mindmap-bulk button:first-child')
  check(await page.$$eval('.mindmap-node', e => e.length) === before, 'expand all opens every nested branch')
  await page.click('.mindmap-root > ul > li:first-child > .mindmap-node')
  check(await page.$$eval('.mindmap-node', e => e.length) === before - 2, 'individual branches remain independently collapsible')
  await page.click('.mindmap-bulk button:first-child')
  check(await page.$$eval('.mindmap-node', e => e.length) === before && posts === 1, 'repeat expand-all applies after manual changes without any new generation')
  await page.click('.mindmap-zoom')
  await page.click('[aria-label="放大导图"]')
  check(await page.$eval('.mindmap-tree', e => new DOMMatrix(getComputedStyle(e).transform).a > 1), 'zoom control enlarges map')
  const camera = () => page.$eval('.mindmap-tree', e => { const m = new DOMMatrix(getComputedStyle(e).transform); return {x:m.e,y:m.f,scale:m.a} })
  const view = await page.$eval('.mindmap-viewport', e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })
  await page.click('.mindmap-zoom')
  const dragStart = {x:view.x+view.width-90,y:view.y+view.height-90}
  await page.mouse.move(dragStart.x,dragStart.y)
  await page.mouse.down()
  await page.mouse.move(dragStart.x-80,dragStart.y-45,{steps:8})
  await page.mouse.up()
  let moved = await camera()
  check(Math.abs(moved.x+80)<2 && Math.abs(moved.y+45)<2, 'background dragging freely translates the map')
  await page.click('.mindmap-zoom')
  const node = await page.$eval('.mindmap-root > .mindmap-node', e => {const r=e.getBoundingClientRect();return {x:r.x+40,y:r.y+20}})
  await page.mouse.move(node.x,node.y)
  await page.mouse.down()
  await page.mouse.move(node.x+65,node.y+35,{steps:8})
  await page.mouse.up()
  check(await page.$$eval('.mindmap-node', e => e.length) === before && (await camera()).x > 50, 'dragging from a node pans without toggling it')
  const pointer = {x:view.x+view.width*.6,y:view.y+view.height*.4}
  await page.mouse.move(pointer.x,pointer.y)
  const sendWheel = values => page.$eval('.mindmap-viewport', (e, init) => e.dispatchEvent(new WheelEvent('wheel', {bubbles:true,cancelable:true,...init})), {clientX:pointer.x,clientY:pointer.y,...values})
  for (const delta of [{deltaX:18,deltaY:12.5}, {deltaX:0,deltaY:100}, {deltaX:-75,deltaY:0}, {deltaX:0,deltaY:-3,deltaMode:1}]) {
    const previous = await camera()
    await sendWheel(delta)
    const next = await camera(), unit=delta.deltaMode===1?16:1
    check(next.scale === previous.scale && Math.abs(next.x-previous.x+delta.deltaX*unit)<.01 && Math.abs(next.y-previous.y+delta.deltaY*unit)<.01, `unmodified scroll pans without zoom: ${JSON.stringify(delta)}`)
  }
  const old = await camera()
  await sendWheel({deltaY:-10,ctrlKey:true})
  await page.waitForFunction(scale => new DOMMatrix(getComputedStyle(document.querySelector('.mindmap-tree')).transform).a > scale,{},old.scale)
  const afterWheel = await camera()
  const localX=pointer.x-view.x,localY=pointer.y-view.y
  check(Math.abs((localX-old.x)/old.scale-(localX-afterWheel.x)/afterWheel.scale)<1 && Math.abs((localY-old.y)/old.scale-(localY-afterWheel.y)/afterWheel.scale)<1, 'trackpad pinch zoom preserves the world point beneath the pointer')
  await page.click('.mindmap-zoom')
  const sendGesture = (type, scale) => page.$eval('.mindmap-viewport', (e, init) => {
    const event = new Event(init.type,{bubbles:true,cancelable:true})
    Object.assign(event,{scale:init.scale,clientX:init.x,clientY:init.y})
    e.dispatchEvent(event)
  },{type,scale,x:pointer.x,y:pointer.y})
  await sendGesture('gesturestart',1)
  await sendGesture('gesturechange',1.5)
  const safariCamera = await camera()
  check(Math.abs(safariCamera.scale-1.5)<.001, 'Safari gesture stream zooms the map')
  await sendWheel({deltaY:-10,ctrlKey:true})
  check(JSON.stringify(await camera())===JSON.stringify(safariCamera), 'duplicate pinch wheel stream does not apply zoom twice')
  await sendGesture('gestureend',1.5)
  await sendWheel({deltaY:-10,metaKey:true})
  check((await camera()).scale>safariCamera.scale, 'modifier wheel zoom resumes after Safari gesture ends')
  await page.mouse.down()
  await page.mouse.move(view.x+view.width+40,view.y-20,{steps:8})
  await page.mouse.up()
  check(!await page.$('.mindmap-viewport.is-panning'), 'releasing outside the canvas ends the captured drag')
  const released = await camera()
  await page.mouse.move(pointer.x,pointer.y)
  check(JSON.stringify(await camera())===JSON.stringify(released), 'pointer motion after release does not move the map')
  await page.$eval('.mindmap-viewport', e => { for(let i=0;i<30;i++) e.dispatchEvent(new WheelEvent('wheel',{deltaY:-1000,ctrlKey:true,bubbles:true,cancelable:true})) })
  check(Math.abs((await camera()).scale-3)<.001, 'zoom-in stops at 300 percent')
  await page.$eval('.mindmap-viewport', e => { for(let i=0;i<40;i++) e.dispatchEvent(new WheelEvent('wheel',{deltaY:1000,ctrlKey:true,bubbles:true,cancelable:true})) })
  check(Math.abs((await camera()).scale-.2)<.001, 'zoom-out stops at 20 percent')
  await page.click('.mindmap-fit')
  check(await page.$eval('.mindmap-tree', e => {const r=e.getBoundingClientRect(),v=e.parentElement.getBoundingClientRect();return r.left>=v.left-1&&r.top>=v.top-1&&r.right<=v.right+1&&r.bottom<=v.bottom+1}), 'fit brings the whole map back into view')
  check(posts === 1 && await page.evaluate(()=>window.scrollY===0), 'canvas gestures do not generate again or scroll the underlying page')
  await page.screenshot({path:'/tmp/mindmap-desktop.png'})
  await page.keyboard.press('Escape')
  check(!await page.$('dialog[open]'), 'Escape closes without closing the TOC')
  check(await page.$$eval('.toc-mindmap', els => els[0].classList.contains('is-ready') && els[0].getAttribute('aria-label').includes('已生成') && !els[1].classList.contains('is-ready')), 'generation immediately marks only its matching TOC entry ready')
  check(await page.$eval('.toc-mindmap', e => e === document.activeElement), 'focus returns to originating map button')
  await page.click('.toc-mindmap')
  await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts === 1, 'reopen reads persisted result without generation')
  check(await page.$eval('.mindmap-toolbar', e => e.textContent.includes('无新增 AI')), 'cached status explicitly confirms no new AI call')
  await openFixture()
  await page.waitForFunction(() => document.querySelectorAll('.toc-mindmap.is-ready').length === 2)
  check(posts === 1, 'saved status survives reload without regenerating')
  await page.click('.toc-mindmap')
  await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts === 1 && reads >= 3, 'page reload reuses server result')
  await page.setViewport({width:390,height:844})
  await page.screenshot({path:'/tmp/mindmap-mobile.png'})
  check(await page.$eval('.mindmap-dialog', e => {const r=e.getBoundingClientRect();return Math.abs(r.x)<1&&Math.abs(r.y)<1&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1}), 'mind map also fills the mobile reading area')
  check(await page.$eval('.mindmap-viewport', e => getComputedStyle(e).overflow === 'clip' && getComputedStyle(e).touchAction === 'none'), 'canvas contains gestures without scrolling the reading page')
  await page.click('.mindmap-zoom')
  const touchView = await page.$eval('.mindmap-viewport', e => {const r=e.getBoundingClientRect();return {x:r.x+150,y:r.y+160}})
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
  const fingers = gap => [{x:touchView.x-gap,y:touchView.y,id:1},{x:touchView.x+gap,y:touchView.y,id:2}]
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:fingers(30)})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:fingers(60)})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  check((await camera()).scale>1.5 && await page.$$eval('.mindmap-node',e=>e.length)===before, 'two-finger pinch zooms without collapsing a node')
  const pinchCamera = await camera()
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchView.x,y:touchView.y,id:1}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchView.x+40,y:touchView.y+30,id:1}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  check((await camera()).x>pinchCamera.x+25, 'single-finger drag pans the map')
  check(await page.evaluate(()=>window.visualViewport.scale===1), 'touch gestures leave browser page zoom unchanged')
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false})
  await cdp.detach()
  await page.click('[aria-label="关闭思维导图"]')
  check(!await page.$('dialog[open]'), 'close button closes the dialog')
  await page.setViewport({width:1440,height:1000})
  await openFixture()
  await page.click('.toc-mindmap'); await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(await page.$eval('.mindmap-dialog', e => e.dataset.mapTheme === 'porcelain'), 'new readers start with the Porcelain theme')
  await page.click('.mindmap-root > ul > li:first-child > .mindmap-node')
  await page.click('[aria-label="放大导图"]')
  const appearanceCamera = await camera(), appearanceNodes = await page.$$eval('.mindmap-node', els => els.map(e => e.textContent))
  await page.click('.mindmap-theme-trigger')
  check(await page.$$eval('[data-mindmap-theme-option]', els => els.length === 5), 'theme picker offers exactly five visual previews')
  const palettes = new Set(), themeReads = reads
  const contrast = await page.evaluate(() => {
    // Measure actual browser-composited CSS colors (including color-mix), not just palette literals.
    window.__themeContrast = () => {
      const canvas = document.createElement('canvas'); canvas.width=canvas.height=1
      const ctx=canvas.getContext('2d')
      const rgb = color => {ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)}
      const light = color => rgb(color).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0)
      const ratio = (a,b) => {const x=light(a),y=light(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
      const dialog=document.querySelector('.mindmap-dialog'), base=getComputedStyle(dialog).backgroundColor
      const checks=[...document.querySelectorAll('.mindmap-node')].map(node=>{const s=getComputedStyle(node);return ratio(s.color,s.backgroundColor==='rgba(0, 0, 0, 0)'?base:s.backgroundColor)})
      const toolbar=document.querySelector('.mindmap-toolbar'), style=getComputedStyle(toolbar)
      checks.push(ratio(style.color,style.backgroundColor))
      return Math.min(...checks)
    }
    return true
  })
  check(contrast, 'contrast audit uses rendered text and surfaces')
  for(const theme of ['porcelain','ink','grove','midnight','sand']) {
    await page.click(`[data-mindmap-theme-option="${theme}"]`)
    await page.waitForFunction(theme=>document.querySelector('.mindmap-dialog').dataset.mapTheme===theme,{},theme)
    check(await page.$eval(`[data-mindmap-theme-option="${theme}"]`, e=>e.getAttribute('aria-pressed')==='true'), `theme selection is announced: ${theme}`)
    palettes.add(await page.$eval('.mindmap-dialog',e=>getComputedStyle(e).backgroundColor))
    const minimum=await page.evaluate(()=>window.__themeContrast())
    check(minimum>=4.5, `${theme} rendered text contrast meets 4.5:1 (${minimum.toFixed(2)})`)
    check(JSON.stringify(await camera())===JSON.stringify(appearanceCamera)&&JSON.stringify(await page.$$eval('.mindmap-node',els=>els.map(e=>e.textContent)))===JSON.stringify(appearanceNodes), `${theme} preserves the camera, content and collapsed branches`)
    await page.waitForFunction(()=>document.querySelectorAll('.mindmap-connections path').length===document.querySelectorAll('.mindmap-node').length-1)
    check(await page.evaluate(()=>{
      const tree=document.querySelector('.mindmap-tree'), bounds=tree.getBoundingClientRect(), scale=bounds.width/tree.offsetWidth
      return [...document.querySelectorAll('.mindmap-connections path')].every(edge=>{
        const path=edge.dataset.edge, parent=document.querySelector(`[data-node-path="${path.slice(0,path.lastIndexOf('.'))}"]`).getBoundingClientRect(), child=document.querySelector(`[data-node-path="${path}"]`).getBoundingClientRect()
        const from=edge.getPointAtLength(0),to=edge.getPointAtLength(edge.getTotalLength())
        return Math.abs(from.x*scale+bounds.left-parent.right)<2&&Math.abs(from.y*scale+bounds.top-parent.top-parent.height/2)<2&&Math.abs(to.x*scale+bounds.left-child.left)<2&&Math.abs(to.y*scale+bounds.top-child.top-child.height/2)<2
      })
    }), `${theme} curves stay attached to their parent and child nodes`)
    await page.screenshot({path:`/tmp/mindmap-theme-${theme}.png`})
  }
  check(palettes.size===5&&posts===1&&reads===themeReads, 'all five distinct appearances switch without any new generation')
  await page.keyboard.press('Escape')
  check(!!await page.$('.mindmap-dialog[open]')&&!await page.$('.mindmap-theme-panel')&&await page.$eval('.mindmap-theme-trigger', e=>e===document.activeElement),'first Escape closes only the theme picker and restores its trigger focus')
  await page.keyboard.press('Enter'); await page.waitForSelector('.mindmap-theme-panel')
  await page.mouse.click(1400,800)
  check(!await page.$('.mindmap-theme-panel')&&!!await page.$('.mindmap-dialog[open]'),'outside click dismisses the picker without closing the map')
  await page.keyboard.press('Escape')
  await openFixture();await page.click('.toc-mindmap');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(await page.$eval('.mindmap-dialog', e=>e.dataset.mapTheme==='sand')&&posts===1,'theme survives close, reopen and page reload without inference')
  await page.setViewport({width:390,height:844})
  await page.click('.mindmap-theme-trigger');await page.waitForSelector('.mindmap-theme-panel')
  check(await page.$eval('.mindmap-theme-panel', e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),'theme chooser stays within narrow viewports')
  await page.click('[data-mindmap-theme-option="midnight"]')
  await page.screenshot({path:'/tmp/mindmap-themes-mobile.png'})
  await page.keyboard.press('Escape')
  await page.click('.mindmap-bulk button:last-child')
  await page.waitForFunction(()=>!document.querySelector('.mindmap-connections path'))
  check(await page.$$eval('.mindmap-node',e=>e.length)===1, 'collapse-all removes hidden connectors in the new renderer')
  await page.click('.mindmap-bulk button:first-child')
  await page.waitForFunction(()=>document.querySelectorAll('.mindmap-connections path').length===document.querySelectorAll('.mindmap-node').length-1)
  check(posts===1, 'expanding the themed tree redraws connections without inference')
  await page.evaluate(()=>localStorage.setItem('ir:mindmap-theme','invalid-theme'))
  await openFixture();await page.click('.toc-mindmap');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(await page.$eval('.mindmap-dialog', e=>e.dataset.mapTheme==='porcelain'),'unknown stored themes safely fall back to Porcelain')
  check(errors.length===0, 'no browser runtime errors')
} finally { await browser.close() }
