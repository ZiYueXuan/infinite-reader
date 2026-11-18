import { noteSource } from './note-editor-helpers.mjs'
// Browser regression for notes inserted below the selected line as quote blocks.
// Start Vite in local mode, then:
// PUPPETEER_CORE=<puppeteer-core module> CHROME_BIN=<chromium> READER_URL='http://127.0.0.1:5173/?sample=zh' node scripts/check-inline-notes.mjs
// Uses a fresh browser profile, IndexedDB, the actual selection/editor UI and the 3D scene.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const url = process.env.READER_URL || 'http://127.0.0.1:5173/?sample=zh'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(120000)
await page.evaluateOnNewDocument(() => {
  const post = Worker.prototype.postMessage
  window.__noteWorkerFonts = []
  Worker.prototype.postMessage = function(message, ...rest) {
    if (message?.t === 'init' && Array.isArray(message.fonts)) window.__noteWorkerFonts.push(message.fonts)
    return post.call(this, message, ...rest)
  }
})
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
const check = (condition, label) => { assert.ok(condition, label); console.log('PASS', label) }
const ready = () => page.waitForFunction(() => window.__reader?.hasBook && window.__store?.getState().current && !window.__store.getState().loading, { timeout: 120000 })
const settle = () => page.evaluate(() => { window.__reader.advance(3); window.__reader.renderNow() })
const inspect = (id) => page.evaluate((id) => {
  const r = window.__reader, s = window.__store.getState(), pag = r.pagination
  return {
    annotation: s.annotations.find(a => a.id === id), editing: s.editingNote?.id,
    source: JSON.stringify(s.current.parsed.chapters),
    sourceWords: pag.pages.flatMap(p => p.lines.flatMap(l => l.words.filter(w => w.s >= 0).map(w => [p.chapter,w.s,w.e,w.text]))),
    pages: pag.pages.map(p => ({ index:p.index, chapter:p.chapter, special:p.special, start:p.start,end:p.end,
      lines:p.lines.map(l => ({y:l.y,h:l.h,start:l.words.find(w=>w.s>=0)?.s,end:l.words.filter(w=>w.e>=0).at(-1)?.e})),
      notes:(p.notes??[]).map(n => ({id:n.id,y:n.y,h:n.h,continued:n.continued,continues:n.continues,textColor:n.textColor,
        text:n.lines.map(l=>l.words.map(w=>w.text).join('')).join(''),
        lines:n.lines.map(l=>({y:l.y,h:l.h,invalid:l.words.some(w=>w.s!==-1||w.e!==-1)}))})),
    })),
    bounds: {h:pag.config.pageH-pag.config.marginTop-pag.config.marginBottom,w:pag.config.pageW-pag.config.marginInner-pag.config.marginOuter},
    legacyObjects: r.notes?.size ?? 0,
  }
}, id)
const editText = async (text) => {
  await page.waitForSelector('.note-rich-content', {visible:true})
  await page.focus('.note-rich-content')
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.sendCharacter(text)
}
const finish = async (id, text) => {
  await page.click('[data-note-done]')
  await page.waitForFunction((id) => !window.__store.getState().editingNote && window.__reader.pagination.pages.some(p => p.notes?.some(n => n.id===id)), {}, id)
  // Reflow is async; wait for its painted data, not just the persisted annotation.
  await page.waitForFunction((id,text) => window.__reader.pagination.pages.flatMap(p=>p.notes??[]).filter(n=>n.id===id).map(n=>n.lines.map(l=>l.words.map(w=>w.text).join('')).join('')).join('').includes(text.replace(/\s/g,'')), {}, id, text)
  // Colour/tag-only edits leave the text unchanged, so wait for the complete
  // rendered snapshot as well instead of accepting the previous page's text.
  await page.waitForFunction(async () => {
    const { noteLayoutSignature } = await import('/src/book/annotations.ts')
    return window.__reader.pagination.noteSignature === noteLayoutSignature(window.__store.getState().annotations)
  })
  await settle()
}
try {
  await page.goto(url, {waitUntil:'domcontentloaded'})
  await ready(); await settle()
  // Inspect the very first painted frame, before a worker response or another RAF
  // can hide blank textures. Waiting for the final layout misses the save flash.
  await page.evaluate(() => {
    const r = window.__reader, reflow = r.reflow, renderNow = r.renderNow
    window.__reflowFrames = []
    let replacing = false
    r.reflow = function (...args) {
      replacing = true
      try { return reflow.apply(this, args) } finally { replacing = false }
    }
    r.renderNow = function (...args) {
      const result = renderNow.apply(this, args)
      if (replacing) {
        const t = this.turnedLeaves
        const pages = [2*t-2, 2*t-1, 2*t, 2*t+1].filter(p => p >= 0 && p < this.pagination.pages.length)
        window.__reflowFrames.push(pages.every(p => this.tex.get(p).image.width > 4))
      }
      return result
    }
  })
  const target = await page.evaluate(() => {
    const r=window.__reader,s=window.__store.getState(),pag=r.pagination
    const p=pag.pages.find(p=>!p.special && s.current.parsed.chapters[p.chapter].blocks.some(b=>b.kind==='p'&&p.lines.filter(l=>l.words.some(w=>w.s>=b.start&&w.s<b.start+b.text.length)).length>=3))
    const b=s.current.parsed.chapters[p.chapter].blocks.find(b=>b.kind==='p'&&p.lines.filter(l=>l.words.some(w=>w.s>=b.start&&w.s<b.start+b.text.length)).length>=3)
    const lines=p.lines.filter(l=>l.words.some(w=>w.s>=b.start&&w.s<b.start+b.text.length))
    const line=lines[1], first=line.words.find(w=>w.s>=0), last=line.words.filter(w=>w.e>=0).at(-1)
    const locator={chapter:p.chapter,start:first.s,end:last.e}
    window.__inlineBaseline={source:JSON.stringify(s.current.parsed.chapters),sourceWords:pag.pages.flatMap(p=>p.lines.flatMap(l=>l.words.filter(w=>w.s>=0).map(w=>[p.chapter,w.s,w.e,w.text]))),pages:JSON.stringify(pag.pages),font:s.readerFont}
    r.revealLocator(locator);r.advance(3);r.renderNow()
    return {...locator,page:p.index,anchorBottom:line.y+line.h,nextStart:lines[2].words.find(w=>w.s>=0).s,nextY:lines[2].y}
  })
  // Create a native DOM selection on the actual text overlay.
  await page.evaluate(({chapter,start,end}) => {
    const words=[...document.querySelectorAll('.text-layer .w')].filter(el=>Number(el.dataset.c)===chapter&&Number(el.dataset.s)>=start&&Number(el.dataset.e)<=end)
    if(!words.length)throw new Error('Source words were not projected')
    const range=document.createRange();range.setStart(words[0].firstChild,0);range.setEnd(words.at(-1).firstChild,words.at(-1).textContent.length)
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);document.dispatchEvent(new Event('selectionchange'))
  },target)
  await page.waitForFunction(()=>window.__store.getState().popover?.kind==='selection')
  const noteButton = await page.waitForFunction(()=>[...document.querySelectorAll('.pop button')].find(b=>/note|笔记/i.test(b.title)))
  await noteButton.asElement().click()
  await page.waitForSelector('.note-rich-content',{visible:true})
  const id=await page.evaluate(()=>window.__store.getState().editingNote.id)
  let state=await inspect(id)
  check(!state.pages.some(p=>p.notes.some(n=>n.id===id)), 'new editor opens before inserting its inline block')
  check(state.legacyObjects===0,'no detached sticky-note mesh is created')
  const original=await page.evaluate(()=>window.__inlineBaseline)
  check(state.source===original.source&&JSON.stringify(state.sourceWords)===JSON.stringify(original.sourceWords),'note creation preserves source text, token offsets and source ordering')
  const short='这里的“合作”值得停下来思考：共同的想象，如何让陌生人采取一致的行动？'
  const beforeTyping=JSON.stringify(state.pages)
  await editText(short)
  state=await inspect(id)
  check(JSON.stringify(state.pages)===beforeTyping,'typing saves note text without repaginating under the caret')
  await finish(id,short)
  state=await inspect(id)
  const blockPage=state.pages.find(p=>p.notes.some(n=>n.id===id)),block=blockPage.notes.find(n=>n.id===id)
  check(blockPage.index===target.page&&block.y>=target.anchorBottom,'new quote block follows the selected visual line')
  const after=blockPage.lines.find(l=>l.start===target.nextStart)
  check(after&&after.y>=block.y+block.h&&after.y>target.nextY,'the remaining paragraph moves below the note')

  check(await page.evaluate(() => window.__reflowFrames.length > 0 && window.__reflowFrames.every(Boolean)),
    'creating and saving notes paints the new spread without any blank placeholder frame')
  // Recolouring later replaces prepainted canvases with worker bitmaps, whose
  // orientation differs. A worker failure must also switch back correctly.
  await page.evaluate(() => window.__reader.tex.setMarks(window.__store.getState().annotations))
  await page.waitForFunction(() => {
    const r = window.__reader
    return Object.values(r.visiblePages).filter(p => p >= 0).every(p => r.tex.get(p).image instanceof ImageBitmap)
  })
  check(await page.evaluate(() => {
    const r = window.__reader
    return Object.values(r.visiblePages).filter(p => p >= 0).every(p => !r.tex.get(p).flipY)
  }), 'worker repaint keeps prepainted text upright')
  await page.evaluate(() => window.__reader.tex.dropWorker())
  await page.waitForFunction(() => {
    const r = window.__reader
    return Object.values(r.visiblePages).filter(p => p >= 0).every(p => r.tex.get(p).image instanceof HTMLCanvasElement)
  })
  check(await page.evaluate(() => {
    const r = window.__reader
    return Object.values(r.visiblePages).filter(p => p >= 0).every(p => r.tex.get(p).flipY)
  }), 'main-thread fallback keeps repainted text upright')
  await page.click(`.inline-note-hit[data-inline-note-id="${id}"]`)
  await page.waitForSelector('.note-rich-content',{visible:true})
  check(await noteSource(page)===short,'clicking the quote block reopens the saved note')
  await page.evaluate(() => {
    const r = window.__reader, s = window.__store.getState(), reflow = s.reflowNotes
    window.__unchangedNote = { book: r.book, pagination: r.pagination, textures: r.tex, view: JSON.stringify(r.view), calls: 0 }
    window.__store.setState({ reflowNotes: (...args) => { window.__unchangedNote.calls++; return reflow(...args) } })
  })
  await finish(id,short)
  check(await page.evaluate(() => {
    const r = window.__reader, before = window.__unchangedNote
    return before.calls === 0 && r.book === before.book && r.pagination === before.pagination && r.tex === before.textures && JSON.stringify(r.view) === before.view
  }), 'Done without edits closes the editor without reflowing or replacing book textures')
  await page.click(`.inline-note-hit[data-inline-note-id="${id}"]`)
  await editText(short + '临时修改')
  await editText(short)
  await finish(id,short)
  check(await page.evaluate(() => window.__unchangedNote.calls === 0), 'editing then restoring the original text also skips reflow')
  await page.click(`.inline-note-hit[data-inline-note-id="${id}"]`)
  await page.click('[data-note-tag-input]');await page.keyboard.sendCharacter('思考');await page.keyboard.press('Enter')
  await finish(id,short)
  check(await page.evaluate(() => window.__unchangedNote.calls === 1), 'a tag-only edit still triggers reflow')
  state=await inspect(id)
  check(state.annotation.note.tags.includes('思考')&&state.pages.flatMap(p=>p.notes).some(n=>n.text.includes('思考')),'tags persist and render inside the quote block')
  const markColor = state.annotation.color
  await page.locator(`.inline-note-hit[data-inline-note-id="${id}"]`).click()
  await page.click('.note-color-btn')
  await page.click('[data-note-color-option="blue"]')
  check(await page.$eval('.note-rich-content', el => getComputedStyle(el).color) === 'rgb(49, 95, 145)', 'note palette previews the selected text ink')
  await finish(id,short)
  state=await inspect(id)
  check(state.annotation.color===markColor&&state.annotation.note.textColor==='blue'&&state.pages.flatMap(p=>p.notes).filter(n=>n.id===id).every(n=>n.textColor==='blue'), 'changing note ink leaves the source mark unchanged and paints the note')
  await page.evaluate(id=>window.__store.getState().setPopover({kind:'mark',id,rect:{left:500,top:300,width:80,height:24}}),id)
  await page.click('.pop .swatches [title="Pink"]')
  state=await inspect(id)
  check(state.annotation.color==='pink'&&state.annotation.note.textColor==='blue', 'original-text toolbar changes the mark without changing note ink')
  await page.evaluate(()=>window.__store.getState().setPopover(null))
  check(await page.evaluate(async id=>{
    const {toServerAnnotation,toServerNote,fromServerAnnotation}=await import('/src/storage/apiAdapter.ts')
    const a=window.__store.getState().annotations.find(a=>a.id===id),n=toServerNote(a)
    const server={...toServerAnnotation(a),bookId:a.bookId,createdAt:a.createdAt,updatedAt:a.updatedAt,noteId:n.id}
    const restored=fromServerAnnotation(server,n)
    const legacy=fromServerAnnotation(server,{...n,color:'violet',anchor:{...n.anchor,textColor:undefined}})
    return restored.color==='pink'&&restored.note.textColor==='blue'&&n.anchor.textColor==='blue'&&!legacy.note.textColor
  },id), 'API mapping preserves independent colours and keeps legacy notes on default ink')
  const selectFont = async font => {
    await page.click('[data-note-font]')
    await page.locator(`[data-note-font-option="${font}"]`).click()
    await page.waitForFunction(()=>!document.querySelector('[data-note-font]')?.disabled)
  }
  await page.locator(`.inline-note-hit[data-inline-note-id="${id}"]`).click()
  // A failed download must leave the note on its previous font, and allow a later retry.
  await page.evaluate(()=>{
    window.__originalFontLoad=FontFace.prototype.load
    FontFace.prototype.load=function(){return this.family.replaceAll('"','')==='Zhi Mang Xing'?Promise.reject(new Error('Test font download unavailable')):window.__originalFontLoad.call(this)}
  })
  await selectFont('zhi-mang-xing')
  check(await page.evaluate(id=>window.__store.getState().annotations.find(a=>a.id===id).note.font==='wenkai',id), 'failed font download keeps the default LXGW WenKai font')
  await page.evaluate(()=>{FontFace.prototype.load=window.__originalFontLoad})
  const fonts=[['ma-shan-zheng','Ma Shan Zheng'],['zhi-mang-xing','Zhi Mang Xing'],['caveat','Caveat Variable'],['noto-sans','Noto Sans SC Variable'],['noto-serif','Noto Serif SC Variable'],['wenkai','LXGW WenKai'],['long-cang','Long Cang']]
  for(const [font,family] of fonts){
    if(!await page.$('.note-editor'))await page.locator(`.inline-note-hit[data-inline-note-id="${id}"]`).click()
    await selectFont(font)
    check(await page.$eval('.note-rich-content',(el,family)=>getComputedStyle(el).fontFamily.includes(family),family), `${font}: editor uses the chosen family`)
    check(await page.evaluate(family=>[...document.fonts].some(f=>f.family.replaceAll('"','')===family&&f.status==='loaded'),family), `${font}: real font assets are loaded`)
    await finish(id,short)
    check(await page.evaluate(({id,font,family})=>{
      const a=window.__store.getState().annotations.find(a=>a.id===id),pag=window.__reader.pagination
      const words=pag.pages.flatMap(p=>(p.notes??[]).filter(n=>n.id===id).flatMap(n=>n.lines.flatMap(l=>l.words)))
      const worker=window.__noteWorkerFonts.at(-1)
      return a.note.font===font&&a.color==='pink'&&a.note.textColor==='blue'&&words.every(w=>w.font.includes(family))&&pag.fonts.some(f=>f.family===family)&&worker.some(f=>f.family===family)
    },{id,font,family}), `${font}: page layout and worker receive the font without changing passage/note colours`)
    check(await page.evaluate(async({id,font})=>{
      const {toServerAnnotation,toServerNote,fromServerAnnotation}=await import('/src/storage/apiAdapter.ts')
      const a=window.__store.getState().annotations.find(a=>a.id===id),n=toServerNote(a)
      const server={...toServerAnnotation(a),bookId:a.bookId,createdAt:a.createdAt,updatedAt:a.updatedAt,noteId:n.id}
      return n.anchor.font===font&&fromServerAnnotation(server,n).note.font===font&&!fromServerAnnotation(server,{...n,anchor:{...n.anchor,font:'unrecognized'}}).note.font
    },{id,font}), `${font}: API mapping round-trips font with safe legacy fallback`)
  }
  await page.locator(`.inline-note-hit[data-inline-note-id="${id}"]`).click()
  await page.evaluate(()=>{window.__fontNoop={pag:window.__reader.pagination,tex:window.__reader.tex,calls:window.__unchangedNote.calls}})
  await selectFont('long-cang');await finish(id,short)
  check(await page.evaluate(()=>window.__fontNoop.pag===window.__reader.pagination&&window.__fontNoop.tex===window.__reader.tex&&window.__fontNoop.calls===window.__unchangedNote.calls), 'reselecting the current font then Done does not flash or repaginate')
  await page.locator(`.inline-note-hit[data-inline-note-id="${id}"]`).click()
  await page.click('[data-note-font]')
  await page.waitForSelector('.note-font-menu')
  await fs.mkdir('/tmp/note-font-screenshots',{recursive:true})
  await page.screenshot({path:'/tmp/note-font-screenshots/desktop.png'})
  await page.setViewport({width:390,height:844})
  await page.waitForFunction(()=>{const r=document.querySelector('.note-font-menu')?.getBoundingClientRect();return r&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})
  check(true,'font chooser stays within the mobile viewport and scrolls')
  await page.screenshot({path:'/tmp/note-font-screenshots/mobile.png'})
  await page.keyboard.press('Escape')
  await finish(id,short)
  await page.setViewport({width:1440,height:900});await settle()
  const output=process.env.SCREENSHOT_DIR
  if(output){
    await fs.mkdir(output,{recursive:true})
    await page.waitForFunction(()=>{const r=window.__reader;return Object.values(r.visiblePages).filter(i=>i>=0).every(i=>r.tex.cache.has(i))})
    await page.evaluate(()=>window.__reader.renderNow())
    await page.screenshot({path:output+'/inline-notes.png'})
    await page.click(`.inline-note-hit[data-inline-note-id="${id}"]`)
    await page.waitForSelector('.note-rich-content',{visible:true})
    await page.screenshot({path:output+'/inline-notes-edit.png'})
    await finish(id,short)
  }
  await page.reload({waitUntil:'domcontentloaded'});await ready();await settle()
  state=await inspect(id)
  check(state.annotation?.note?.text===short&&state.pages.some(p=>p.notes.some(n=>n.id===id)),'reload restores persisted notes into the book layout')
  check(state.annotation.note.tags.includes('思考'),'reload preserves note tags')
  check(state.annotation.note.font==='long-cang','reload preserves each note font')
  check(await page.evaluate(id=>window.__reader.pagination.pages.flatMap(p=>(p.notes??[]).filter(n=>n.id===id).flatMap(n=>n.lines.flatMap(l=>l.words))).every(w=>w.font.includes('Long Cang')),id),'reload restores selected font to rendered note text')
  check(state.annotation.color==='pink'&&state.annotation.note.textColor==='blue','reload restores source and note colours independently')
  await page.evaluate(id=>{window.__reader.revealNote(id);window.__reader.advance(3)},id)
  await page.click(`.inline-note-hit[data-inline-note-id="${id}"]`)
  const maxLength=10000 // Editor transaction limit, also exercised in check-note-live-markdown.
  let long='长批注也必须和正文一起翻页，不覆盖原文，也不丢失后半段。'.repeat(80).slice(0,Math.min(1600,maxLength>0?maxLength:1600))
  await editText(long);await finish(id,long)
  state=await inspect(id)
  const fragments=state.pages.flatMap(p=>p.notes.filter(n=>n.id===id))
  check(fragments.length>1,'long notes paginate into continuation fragments')
  check(fragments.every(n=>n.textColor==='blue'),'continued note fragments retain their text ink')
  check(await page.evaluate(id=>window.__reader.pagination.pages.flatMap(p=>(p.notes??[]).filter(n=>n.id===id).flatMap(n=>n.lines.flatMap(l=>l.words))).every(w=>w.font.includes('Long Cang')),id),'all long-note continuations use the chosen font')
  check(fragments.map(n=>n.text).join('').includes(long),'all long-note text survives pagination')
  check(state.pages.every(p=>p.notes.every(n=>n.y>=0&&n.y+n.h<=state.bounds.h+0.6&&n.lines.every(l=>!l.invalid))),'all note fragments stay inside page bounds and outside source offsets')
  check(state.source===original.source&&JSON.stringify(state.sourceWords)===JSON.stringify(original.sourceWords),'long-note pagination preserves every original source word')
  await page.evaluate(id=>{window.__reader.revealNote(id);window.__reader.advance(3)},id)
  await page.click(`.inline-note-hit[data-inline-note-id="${id}"]`)
  long += '导航收起编辑器后仍应更新排版。'
  await editText(long)
  await page.evaluate(()=>window.__store.getState().openAsk())
  await page.waitForFunction((id,text)=>!window.__store.getState().editingNote&&window.__reader.pagination.pages.flatMap(p=>p.notes??[]).filter(n=>n.id===id).map(n=>n.lines.map(l=>l.words.map(w=>w.text).join('')).join('')).join('').includes(text),{},id,long)
  check(true,'opening Ask commits the edited note to the page layout')
  await page.evaluate(()=>window.__store.getState().closeAsk())
  const continuation=await page.evaluate(id=>{
    const r=window.__reader,fragments=r.pagination.pages.flatMap(p=>(p.notes??[]).filter(n=>n.id===id).map(()=>p))
    const p=fragments.find(p=>p.index%2===1&&!p.lines.some(l=>l.words.some(w=>w.s>=0)))
    if(!p)throw new Error('No pure note continuation page to exercise')
    r.goToLeaf(r.pageToLeafTurned(p.index));r.advance(3)
    return {ordinal:fragments.indexOf(p)}
  },id)
  await page.evaluate(async()=>{const s=window.__store.getState();await s.setReaderFont(s.readerFont==='noto-serif'?'wenkai':'noto-serif')})
  await ready();await settle()
  state=await inspect(id)
  check(state.annotation.note.text===long&&state.pages.some(p=>p.notes.some(n=>n.id===id)),'changing the reading font preserves inline notes')
  check(await page.evaluate(id=>window.__store.getState().annotations.find(a=>a.id===id).note.font==='long-cang'&&window.__reader.pagination.pages.flatMap(p=>(p.notes??[]).filter(n=>n.id===id).flatMap(n=>n.lines.flatMap(l=>l.words))).every(w=>w.font.includes('Long Cang')),id),'body font changes do not replace an independently selected note font')
  check(await page.evaluate(({id,ordinal})=>{const r=window.__reader,fragments=r.pagination.pages.flatMap(p=>(p.notes??[]).filter(n=>n.id===id).map(()=>p.index));return Object.values(r.visiblePages).includes(fragments[Math.min(ordinal,fragments.length-1)])},{id,...continuation}),'font changes keep the current long-note continuation visible')
  await page.evaluate(async()=>{const r=window.__reader;r.suspendInteraction(true);await window.__store.getState().reflowNotes()})
  check(await page.evaluate(()=>window.__reader.interactionSuspended&&[...document.querySelectorAll('.inline-note-hit')].every(el=>el.disabled)),'repagination preserves an active modal interaction pause')
  await page.evaluate(()=>window.__reader.suspendInteraction(false))
  const citation=await page.evaluate(loc=>{const r=window.__reader,p=r.pagination.pages[r.pagination.pageForOffset(loc.chapter,loc.start)];return {hasSource:p.lines.some(l=>l.words.some(w=>w.s<=loc.start&&w.e>loc.start)),hasNotes:!!p.notes?.length}},target)
  check(citation.hasSource,'source citation resolves to source text after repagination')
  await page.evaluate(id=>{const r=window.__reader;r.revealNote(id);r.advance(3);r.turn(1);r.advance(3);r.turn(-1);r.advance(3);r.revealNote(id);r.advance(3)},id)
  check(await page.$eval(`.inline-note-hit[data-inline-note-id="${id}"]`,el=>!el.disabled),'quote-block edit target returns after page turns')
  // Restore a compact note before testing deletion and legacy records.
  await page.click(`.inline-note-hit[data-inline-note-id="${id}"]`);await editText(short);await finish(id,short)
  await page.evaluate(async font=>{await window.__store.getState().setReaderFont(font)},original.font);await settle()
  await page.evaluate(id=>window.__store.getState().removeNote(id),id);await settle()
  state=await inspect(id)
  check(!state.annotation.note&&!state.pages.some(p=>p.notes.length),'removing a note returns its space to the source text')
  check(await page.evaluate(pages=>JSON.stringify(window.__reader.pagination.pages)===pages,original.pages),'deleting the final note restores the original pagination exactly')
  await page.evaluate(async(id)=>{
    const {storage}=await import('/src/storage/index.ts');const s=window.__store.getState(),a=s.annotations.find(a=>a.id===id)
    await storage.putAnnotation({...a,note:{text:'旧便笺的内容会出现在原文之间。',tags:['旧笔记'],x:100,y:-30,rot:1.2}})
  },id)
  await page.reload({waitUntil:'domcontentloaded'});await ready();await settle()
  state=await inspect(id)
  check(state.annotation.note.x===100&&state.pages.some(p=>p.notes.some(n=>n.id===id&&n.text.includes('旧便笺的内容'))),'legacy sticky-note records render inline without rewriting saved coordinates')
  check(state.legacyObjects===0,'legacy notes do not recreate desktop paper meshes')
  check(pageErrors.length===0,`no browser runtime errors (${pageErrors.join('; ')})`)
  console.log('PASS inline-note browser regression complete')
} finally { await browser.close() }
