// Real inline-note hit targets in a local sample. No cloud data or provider calls.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:900}})
const page=await browser.newPage(), errors=[]
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
})
page.on('pageerror',e=>errors.push(e.message))
page.setDefaultTimeout(60000)
const check=(ok,label)=>{assert.ok(ok,label);console.log('PASS',label)}
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5174/?sample=zh',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__reader?.hasBook && !window.__store.getState().loading,{timeout:120000})
  await page.evaluate(async()=>{
    const s=window.__store.getState(),r=window.__reader
    const chapter=s.current.parsed.chapters.find(c=>c.blocks.some(b=>b.kind==='p'&&b.text.length>20))
    const block=chapter.blocks.find(b=>b.kind==='p'&&b.text.length>20)
    const a={id:'zoom-note',bookId:s.current.meta.id,quote:block.text.slice(0,20),locator:{chapter:chapter.index,start:block.start,end:block.start+20},kind:'highlight',color:'violet',createdAt:0,updatedAt:0,note:{text:'悬停在笔记和标签上缩放阅读器。',tags:['quote'],font:'inherit',x:0,y:0,rot:0}}
    window.__store.setState({annotations:[a]});r.setAnnotations([a]);r.setOpen(true);r.advance(3)
    await window.__store.getState().reflowNotes(a.id)
    r.advance(3);r.renderNow()
  })
  const cdp=await page.createCDPSession()
  for(const selector of ['.inline-note-hit','.inline-note-tag-hit']) {
    await page.waitForSelector(selector,{visible:true})
    const result=await page.$eval(selector,target=>{
      const r=window.__reader, rect=target.getBoundingClientRect(), x=rect.x+rect.width/2,y=rect.y+rect.height/2
      const wheel=values=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:x,clientY:y,...values});target.dispatchEvent(e);return e.defaultPrevented}
      const zoom=r.view.tzoom,ctrl=wheel({deltaY:-8,ctrlKey:true}),afterCtrl=r.view.tzoom
      const meta=wheel({deltaY:8,metaKey:true}),afterMeta=r.view.tzoom
      const before={...r.view},scroll=wheel({deltaX:12,deltaY:8})
      const scrolled=scroll&&r.view.x===before.x&&r.view.y===before.y&&r.view.tzoom<before.tzoom
      const gesture=(type,scale)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.assign(e,{scale,clientX:x,clientY:y});target.dispatchEvent(e);return e.defaultPrevented}
      const base=r.view.tzoom,start=gesture('gesturestart',1),change=gesture('gesturechange',1.2),pinched=r.view.tzoom
      const duplicate=wheel({deltaY:-8,ctrlKey:true})&&r.view.tzoom===pinched
      const end=gesture('gestureend',1.2)
      return {ctrl:ctrl&&afterCtrl>zoom,meta:meta&&Math.abs(afterMeta-zoom)<.001,scrolled,safari:start&&change&&end&&Math.abs(pinched-base*1.2)<.001,duplicate}
    })
    for(const [kind,ok] of Object.entries(result))check(ok,`${selector}: ${kind} handled by the reader`)
    await page.evaluate(()=>{window.__reader.resetView();window.__reader.advance(3);window.__reader.renderNow()})
    const point=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
    check(await page.evaluate(({x,y,selector})=>document.elementFromPoint(x,y)?.matches(selector),{...point,selector}),`${selector}: pointer reaches the actual projected hit target`)
    const before=await page.evaluate(()=>({zoom:window.__reader.view.tzoom,scale:visualViewport.scale,width:innerWidth,dpr:devicePixelRatio}))
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-100})
    await page.waitForFunction(z=>window.__reader.view.tzoom>z,{},before.zoom)
    check(await page.evaluate(b=>visualViewport.scale===b.scale&&innerWidth===b.width&&devicePixelRatio===b.dpr&&__reader.view.tzoom/b.zoom<1.13,before),`${selector}: ordinary browser wheel gently zooms the reader without browser zoom`)
  }
  const point={x:1100,y:600}
  const anchor=await page.evaluate(point=>{
    const r=__reader;r.resetView();r.advance(3);r.renderNow()
    return {world:r.unproject(point.x,point.y,0),zoom:r.view.tzoom,page:r.turnedLeaves}
  },point)
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-100})
  await page.waitForFunction(z=>__reader.view.tzoom>z,{},anchor.zoom)
  check(await page.evaluate(({anchor,point})=>{
    const r=__reader;r.advance(3);r.renderNow();const projected=r.project(anchor.world.x,anchor.world.y,0)
    return Math.hypot(projected.x-point.x,projected.y-point.y)<1&&r.turnedLeaves===anchor.page
  },{anchor,point}),'ordinary wheel keeps the point under the cursor fixed and does not turn a page')
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:100})
  await page.waitForFunction(z=>Math.abs(__reader.view.tzoom-z)<.0001,{},anchor.zoom)
  check(true,'opposite wheel movement reverses the zoom')
  check(await page.evaluate(()=>{
    const r=__reader,wheel=values=>r.canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:1100,clientY:600,...values}))
    for(const [deltaMode,deltaY] of [[0,-10000],[1,-3],[2,-1]]) {
      r.resetView();const before=r.view.tzoom;wheel({deltaMode,deltaY})
      if(!(r.view.tzoom>before&&r.view.tzoom/before<1.13))return false
    }
    r.resetView();const before={...r.view};wheel({deltaX:100,deltaY:0})
    return r.view.tzoom===before.tzoom&&r.view.x===before.x&&r.view.y===before.y
  }),'pixel, line and page wheels stay gentle; horizontal-only scroll does not move the book')
  check(await page.evaluate(()=>{
    const r=__reader,wheel=deltaY=>r.canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY,clientX:1100,clientY:600}))
    r.view.tzoom=6.99;wheel(-120);const max=r.view.tzoom
    r.view.tzoom=.1201;wheel(120);const min=r.view.tzoom
    r.resetView();r.advance(3);r.renderNow()
    return max===7&&min===.12
  }),'wheel zoom respects both zoom limits')
  check(await page.evaluate(()=>{
    const r=window.__reader,button=document.createElement('button');button.dataset.ui='';r.el.appendChild(button)
    const before=r.view.tzoom,e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-12,ctrlKey:true});button.dispatchEvent(e);button.remove()
    return !e.defaultPrevented&&r.view.tzoom===before
  }),'unrelated UI controls remain excluded')
  check(await page.evaluate(()=>{
    const r=window.__reader;r.suspendInteraction(true);const before=r.view.tzoom
    document.querySelector('.inline-note-tag-hit').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-12,ctrlKey:true}))
    const unchanged=r.view.tzoom===before;r.suspendInteraction(false);return unchanged
  }),'modal suspension still prevents background reader zoom')
  check(await page.evaluate(()=>!window.__store.getState().editingNote&&!document.querySelector('dialog[open]')),'zoom never activates note editing or tag browsing')
  check(errors.length===0,`no browser errors: ${errors.join('; ')}`)
} finally {await browser.close()}
