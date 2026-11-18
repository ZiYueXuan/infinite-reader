// Local sample book and real 3D text hit targets; no accounts, provider calls or cloud writes.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:900}})
const page=await browser.newPage(), errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.setDefaultTimeout(60000)
const check=(value,label)=>{assert.ok(value,label);console.log('PASS',label)}
const settle=()=>page.evaluate(()=>{window.__reader.advance(3);window.__reader.renderNow()})
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5174/?sample=zh',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__reader?.hasBook && !window.__store.getState().loading,{timeout:120000})
  await page.evaluate(async()=>{
    const s=window.__store.getState(), r=window.__reader
    const {DEFAULT_NOTE_FONT}=await import('/src/book/noteFontCatalog.ts')
    window.__defaultNoteFont=DEFAULT_NOTE_FONT
    r.setOpen(true);r.advance(3)
    const chapters=s.current.parsed.chapters.filter(c=>c.blocks.some(b=>b.kind==='p'&&b.text.length>20))
    const annotation=(id,chapter,tag,text)=>{
      const block=chapter.blocks.find(b=>b.kind==='p'&&b.text.length>20)
      return {id,bookId:s.current.meta.id,quote:block.text.slice(0,20),locator:{chapter:chapter.index,start:block.start,end:block.start+20},kind:'highlight',color:'violet',createdAt:0,updatedAt:0,note:{text,tags:[tag],font:'wenkai',x:0,y:0,rot:0}}
    }
    const annotations=[annotation('first',chapters[0],'quote','信息的丰富，造成了注意力的贫困。'),annotation('second',chapters.at(-1),'Quote','另一条同标签笔记。\n<script>window.unsafe=true</script>'),annotation('other',chapters[0],'quotation','不应出现在 quote 列表')]
    window.__store.setState({annotations})
    r.setAnnotations(annotations)
    await window.__store.getState().reflowNotes('first')
    // A stale foreign-book entry must never appear, even if present in memory.
    window.__store.setState({annotations:[...annotations,{...annotations[0],id:'foreign',bookId:'different-book'}]})
    window.__initialNotes=JSON.stringify(window.__store.getState().annotations)
  })
  await settle()
  check(await page.evaluate(()=>window.__defaultNoteFont==='wenkai'),'new notes default to LXGW WenKai')
  await page.evaluate(() => window.__store.getState().editNote('first'))
  await page.waitForSelector('.note-rich-content',{visible:true})
  await page.focus('.note-rich-content')
  await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.press('Backspace')
  await page.click('[data-note-done]')
  await page.waitForFunction(async () => {
    const {noteLayoutSignature}=await import('/src/book/annotations.ts')
    return !window.__store.getState().editingNote && window.__reader.pagination.noteSignature===noteLayoutSignature(window.__store.getState().annotations)
  })
  await settle()
  check(await page.evaluate(()=>{
    const notes=window.__reader.pagination.pages.flatMap(p=>(p.notes??[]).filter(n=>n.id==='first'))
    window.__initialNotes=JSON.stringify(window.__store.getState().annotations)
    return notes.length===1&&notes[0].lines.length===1&&notes[0].lines[0].words.map(w=>w.text).join('')==='#quote'
  }),'Done on a tag-only note leaves only the clickable tag, without placeholder or body row')
  const target='.inline-note-tag-hit[data-note-tag="quote"]'
  await page.waitForSelector(target,{visible:true})
  const bounds=await page.$eval(target,e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
  check(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('inline-note-tag-hit'),bounds),'tag target sits above the note editor hit target')
  await page.click(target)
  await page.waitForSelector('.tag-notes-dialog[open]')
  check(!await page.$('[data-annotation-id="first"] .tag-notes-text'),'tag browser also omits empty note body placeholders')
  check(await page.$$eval('.tag-notes-card',els=>els.length===2&&els[0].dataset.annotationId==='first'&&els[1].dataset.annotationId==='second'),'tag view includes all matching notes in book order, case-insensitive and book scoped')
  check(await page.$eval('.tag-notes-card:nth-child(2)',e=>e.textContent.includes('<script>window.unsafe=true</script>')) && await page.evaluate(()=>!window.unsafe),'note content renders as inert text')
  check(await page.evaluate(()=>!window.__store.getState().editingNote&&window.__reader.interactionSuspended),'tag click opens the overlay instead of editing, with reader input suspended')
  const fullscreen=()=>page.$eval('.tag-notes-dialog',e=>{const r=e.getBoundingClientRect();return r.x===0&&r.y===0&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1})
  check(await fullscreen(),'tag overlay fills desktop reading area')
  await page.screenshot({path:'/tmp/note-tags-desktop.png'})
  await page.keyboard.press('Escape')
  check(!await page.$('dialog[open]')&&await page.evaluate(()=>!window.__reader.interactionSuspended),'Escape closes and restores reader interaction')
  check(await page.$eval(target,e=>e===document.activeElement),'focus returns to clicked tag')
  await page.focus(target);await page.keyboard.press('Enter')
  await page.waitForSelector('.tag-notes-dialog[open]')
  check(true,'tag opens with keyboard Enter')
  await page.setViewport({width:390,height:844})
  check(await fullscreen(),'tag overlay fills mobile reading area')
  check(await page.$eval('.tag-notes-content',e=>e.scrollWidth<=e.clientWidth),'mobile cards do not overflow horizontally')
  await page.screenshot({path:'/tmp/note-tags-mobile.png'})
  const expected=await page.evaluate(()=>window.__store.getState().annotations.find(a=>a.id==='second').locator)
  await page.$eval('[data-annotation-id="second"] button',e=>e.click())
  await settle()
  check(!await page.$('dialog[open]')&&await page.evaluate(loc=>{const r=window.__reader;return r.turnedLeaves===r.pageToLeafTurned(r.pagination.pageForOffset(loc.chapter,loc.start))},expected),'return-to-source closes overlay and reveals the original passage')
  check(await page.evaluate(()=>JSON.stringify(window.__store.getState().annotations)===window.__initialNotes),'browsing tags leaves all annotations unchanged')
  check(errors.length===0,`no browser errors: ${errors.join('; ')}`)
} finally {await browser.close()}
