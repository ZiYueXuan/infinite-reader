// Exercise the editor through its DOM and the same note store used by autosave.
export const noteSource = page => page.evaluate(() => {
  const s = window.__store.getState()
  return s.annotations.find(a => a.id === s.editingNote?.id)?.note?.text ?? ''
})
export const focusNote = page => page.focus('.note-rich-content')
export async function replaceNote(page, text) {
  await focusNote(page)
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  if (!text) { await page.keyboard.press('Backspace'); return }
  await page.evaluate(text => {
    const data = new DataTransfer(); data.setData('text/plain', text)
    document.querySelector('.note-rich-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}
// Map visible text to Markdown only for tests that place/select a known text span.
export const noteSelection = page => page.evaluate(() => {
  const s = window.__store.getState(), source = s.annotations.find(a=>a.id===s.editingNote?.id)?.note?.text ?? ''
  const selection = window.getSelection(), root = document.querySelector('.note-rich-content')
  const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
  let scan=0,from=0,to=0
  for(let node=walker.nextNode();node;node=walker.nextNode()) {
    if(node.parentElement.closest('[contenteditable=false]')) continue
    const at=source.indexOf(node.textContent,scan); if(at<0)continue
    if(node===selection.anchorNode)from=at+selection.anchorOffset
    if(node===selection.focusNode)to=at+selection.focusOffset
    scan=at+node.textContent.length
  }
  return {from:Math.min(from,to),to:Math.max(from,to)}
})
export async function setNoteSelection(page, anchor, head=anchor) {
  await focusNote(page)
  await page.evaluate(({anchor,head})=>{
    const s=window.__store.getState(),source=s.annotations.find(a=>a.id===s.editingNote?.id)?.note?.text??''
    const root=document.querySelector('.note-rich-content'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
    let scan=0,start,end,last
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      if(node.parentElement.closest('[contenteditable=false]'))continue
      const at=source.indexOf(node.textContent,scan);if(at<0)continue
      const len=node.textContent.length
      if(!start&&anchor<=at+len)start=[node,Math.max(0,anchor-at)]
      if(!end&&head<=at+len)end=[node,Math.max(0,head-at)]
      last=[node,len];scan=at+len
    }
    start??=last;end??=last
    if(start&&end) {
      window.getSelection().setBaseAndExtent(...start,...end)
      document.dispatchEvent(new Event('selectionchange'))
    }
  },{anchor,head})
}
export const scanNotePreview = (page, selectors) => page.$eval('.note-rich-content',(root,selectors)=>{
  const seen=selectors.filter(s=>root.querySelector(s==='input[type=checkbox]'?'li[data-checked]':s))
  return {all:seen.length===selectors.length,seen,literalHtml:root.textContent.includes('<script>'),unsafe:!!root.querySelector('script,a[href^="javascript:"]')}
},selectors)
