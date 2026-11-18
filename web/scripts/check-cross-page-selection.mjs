// Local Vite, fresh profile, real mouse drag and real page animation.
// PUPPETEER_CORE=<module> node web/scripts/check-cross-page-selection.mjs
import assert from 'node:assert/strict'
const {default: puppeteer} = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:900}})
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => localStorage.setItem('ir:locale', 'zh-CN'))
page.setDefaultTimeout(60000)
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
const check=(value,message)=>{assert.ok(value,message);console.log('PASS',message)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const go=async index=>{
  await page.evaluate(index=>{const r=window.__reader;r.clearSelection();window.__store.getState().setPopover(null);r.goToLeaf(r.pageToLeafTurned(index));r.advance(3);r.renderNow()},index)
  await page.waitForFunction(index=>window.__reader.visiblePages.right===index&&!window.__reader.book.busy,{},index)
}
const coords=async(index,position)=>page.evaluate(({index,position})=>{
  const words=[...document.querySelectorAll(`.text-page .w[data-p="${index}"]`)]
  const word=words[position<0?words.length+position:position],r=word.getBoundingClientRect()
  return {x:r.left+r.width*0.8,y:r.top+r.height*0.5,start:Number(word.dataset.s),end:Number(word.dataset.e),chapter:Number(word.dataset.c)}
},{index,position})
const corner=()=>page.evaluate(()=>{const edge=window.__reader.text.forwardSelectionEdge();return{x:edge.x+22,y:edge.y+24,end:edge.end}})
async function dragToEnd(index){
  await go(index)
  const a=await coords(index,-9),z=await coords(index,-1)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:15})
  await page.waitForFunction(()=>!!window.__reader.text.readSelection())
  const selection=await page.evaluate(()=>window.__reader.text.readSelection().locator)
  return {a,z,selection}
}
async function trigger(){
  const edge=await corner();await page.mouse.move(edge.x,edge.y,{steps:8})
  await page.waitForFunction(()=>window.__reader.crossSelection.phase==='turning')
  await page.evaluate(()=>{window.__reader.paused=false})
  return edge
}
async function settled(){await page.waitForFunction(()=>window.__reader.crossSelection.phase==='waiting'&&!window.__reader.book.busy)}
try{
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5173/?sample=zh',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__reader?.hasBook&&!window.__store.getState().loading,{timeout:120000})
  const index=await page.evaluate(()=>window.__reader.pagination.pages.find(p=>p.index%2===0&&p.lines.length>8&&window.__reader.pagination.pages[p.index+4]?.chapter===p.chapter)?.index)
  assert.ok(index>=2)
  // Entering and leaving the edge before dwell expires must not turn the page.
  let start=await dragToEnd(index),edge=await corner()
  // Dispatch the brief enter/exit together so slow software WebGL/CDP round trips do not consume the dwell.
  await page.evaluate(({edge,z})=>{const id=window.__reader.crossSelection.pointer;for(const p of [edge,z])window.dispatchEvent(new PointerEvent('pointermove',{pointerId:id,pointerType:'mouse',buttons:1,clientX:p.x,clientY:p.y,bubbles:true}))},{edge,z:start.z})
  await page.mouse.up();await delay(600)
  check(await page.evaluate(index=>window.__reader.visiblePages.right===index&&!window.__reader.book.busy, index),'brief corner crossing does not turn a page')
  // Complete one cross-page selection using actual pointer events.
  start=await dragToEnd(index);edge=await trigger();await settled()
  const held=await page.evaluate(()=>({range:{...window.__reader.crossSelection.range},right:window.__reader.visiblePages.right}))
  await delay(700)
  check(held.right===index+2&&held.range.start===start.selection.start&&held.range.end===edge.end,'turn preserves the exact source range')
  check(await page.evaluate(held=>window.__reader.visiblePages.right===held.right&&window.__reader.crossSelection.range.end===held.range.end,held),'stationary pointer neither selects the new spread nor triggers a second turn')
  const first=await coords(index+1,0),end=await coords(index+1,12)
  await page.mouse.move(first.x,first.y);await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up()
  await page.waitForFunction(()=>window.__store.getState().popover?.kind==='selection')
  let selected=await page.evaluate(()=>window.__store.getState().popover)
  check(selected.locator.start===start.selection.start&&selected.locator.end===end.end,'re-entry extends from the original anchor to the new endpoint')
  check(await page.evaluate(()=>{const s=window.__store.getState(),p=s.popover,blocks=s.current.parsed.chapters[p.locator.chapter].blocks;return p.text===blocks.filter(b=>!b.footnoteDefinition&&b.start<p.locator.end&&b.start+b.text.length>p.locator.start).map(b=>b.text.slice(Math.max(0,p.locator.start-b.start),p.locator.end-b.start)).join('\n')}),'selected quote contains all intervening source text')
  check(await page.evaluate(()=>{const e=new ClipboardEvent('copy',{clipboardData:new DataTransfer(),bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented&&e.clipboardData.getData('text/plain')===window.__store.getState().popover.text}),'copy includes the full cross-page passage')
  check(await page.evaluate(()=>{
    const s=window.__store.getState(), selection=s.popover
    s.setPopover(null)
    window.dispatchEvent(new PointerEvent('pointerup',{pointerId:window.__reader.crossSelection.pointer,pointerType:'mouse',button:0,buttons:0,bubbles:true}))
    const dismissed=!window.__store.getState().popover
    s.setPopover(selection)
    return dismissed
  }),'a later mouse release cannot resurrect a dismissed selection toolbar')
  await page.screenshot({path:'/tmp/cross-selection-complete.png'})
  await page.click('.pop .swatches [title="黄色"]')
  check(await page.evaluate(selected=>{const a=window.__store.getState().annotations;return a.length===1&&JSON.stringify(a[0].locator)===JSON.stringify(selected.locator)&&a[0].quote===selected.text},selected),'cross-page highlight saves as one annotation')
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__reader?.hasBook&&!window.__store.getState().loading,{timeout:120000})
  check(await page.evaluate(selected=>{const a=window.__store.getState().annotations;return a.length===1&&JSON.stringify(a[0].locator)===JSON.stringify(selected.locator)},selected),'reload restores the complete cross-page highlight')
  // Multiple consecutive turns; each must be rearmed by returning to text.
  start=await dragToEnd(index);await trigger();await settled()
  const nextFirst=await coords(index+1,0),nextLast=await coords(index+2,-1)
  await page.mouse.move(nextFirst.x,nextFirst.y);await page.mouse.move(nextLast.x,nextLast.y,{steps:15});await trigger();await settled()
  const last=await coords(index+3,8);await page.mouse.move(last.x,last.y);await page.mouse.up()
  selected=await page.evaluate(()=>window.__store.getState().popover)
  check(selected.locator.start===start.selection.start&&selected.locator.end===last.end,'one held drag can continue across two page turns')
  await page.click('.pop [title="添加行内笔记"]');await page.waitForSelector('.note-rich-content',{visible:true})
  check(await page.evaluate(selected=>{const s=window.__store.getState(),notes=s.annotations.filter(a=>a.note);return notes.length===1&&JSON.stringify(notes[0].locator)===JSON.stringify(selected.locator)},selected),'multi-page passage receives one note with the complete source range')
  await page.click('[data-note-done]')
  // Notes are paginated when editing finishes, not when the editor first opens.
  await page.waitForFunction(()=>{const s=window.__store.getState(),a=s.annotations.find(a=>a.note);return !s.editingNote&&s.scene.pagination.pages.flatMap(p=>p.notes??[]).filter(n=>n.id===a.id).length===1})
  check(true,'finishing the note lays it out once at the passage endpoint')
  await page.evaluate(async()=>{for(const a of [...window.__store.getState().annotations])await window.__store.getState().removeMark(a.id)})
  // Releasing during the animation must not include any text on the next spread.
  start=await dragToEnd(index);edge=await trigger();await page.mouse.up()
  await page.waitForFunction(()=>window.__reader.crossSelection.phase==='finished')
  check(await page.evaluate(edge=>window.__store.getState().popover.locator.end===edge.end,edge),'release during animation keeps the last confirmed endpoint')
  // Escape cancels a pending turn; later mouseup must not resurrect the selection.
  start=await dragToEnd(index);edge=await corner();await page.mouse.move(edge.x,edge.y);await page.keyboard.press('Escape');await page.mouse.up();await delay(650)
  check(await page.evaluate(index=>window.__reader.visiblePages.right===index&&!window.__store.getState().popover,index),'Escape cancels pending turn and selection')
  // Chapter boundaries are explicit, not silently truncated or saved across chapters.
  const boundary=await page.evaluate(()=>window.__reader.pagination.pages.find(p=>p.index%2===0&&p.lines.length&&window.__reader.pagination.pages[p.index+1]?.chapter!==p.chapter)?.index)
  await dragToEnd(boundary);edge=await corner();await page.mouse.move(edge.x,edge.y);await delay(650)
  check(await page.evaluate(boundary=>window.__reader.visiblePages.right===boundary&&document.querySelector('.selection-turn-hint').textContent.includes('章节末尾'),boundary),'chapter boundary shows a message without turning')
  await page.mouse.up()
  check(errors.length===0,`no runtime errors (${errors.join(', ')})`)
  console.log('PASS cross-page selection regression complete')
}catch(error){
  await page.screenshot({path:'/tmp/cross-selection-failure.png'})
  console.log('STATE',await page.evaluate(()=>{const r=window.__reader,c=r?.crossSelection;return{right:r?.visiblePages.right,busy:r?.book?.busy,native:r?.text?.readSelection(),phase:c?.phase,pressed:c?.pressed,range:c?.range,point:c?.point,edge:r?.text?.forwardSelectionEdge(),hint:document.querySelector('.selection-turn-hint')?.textContent,popover:window.__store?.getState().popover}}))
  throw error
}finally{await browser.close()}
