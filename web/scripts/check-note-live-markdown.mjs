// Live single-pane editing, native key events, IME, safe preview, autosave and selection retention.
import assert from 'node:assert/strict'
import { replaceNote } from './note-editor-helpers.mjs'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } })
const page = await browser.newPage(), errors = [], consoleErrors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.setDefaultTimeout(60000)
const check = (ok, name) => { assert.ok(ok, name); console.log('PASS', name) }
const initial = '# 阅读笔记\n\n**引经据典**，*对仗*、~~删去~~与 `code`。\n\n1. 第一项\n2. 第二项\n   - 子项\n\n- [x] 已读\n\n> 这是引用\n\n| 观点 | 说明 |\n| --- | --- |\n| 内容 | **清晰** |\n\n```js\nconst x = 1\n```\n\n[参考][ref]\n\n[ref]: https://example.com\n\n<script>window.unsafe = true</script>\n\n[危险](javascript:alert)\n\n正在编辑'
try {
  await page.evaluateOnNewDocument(() => localStorage.setItem('ir:note-editor-size', JSON.stringify({ width: 650, height: 900 })))
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5187/?sample=zh&lang=zh-CN')
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  await page.evaluate(async text => {
    const s = window.__store.getState(), r = window.__reader
    const c = s.current.parsed.chapters.find(c => c.blocks.some(b => b.kind === 'p' && b.text.length > 20))
    const b = c.blocks.find(b => b.kind === 'p' && b.text.length > 20)
    const a = { id: 'live-markdown', bookId: s.current.meta.id, locator: { chapter: c.index, start: b.start, end: b.start + 10 }, quote: b.text.slice(0, 10), kind: 'highlight', color: 'yellow', createdAt: 1, updatedAt: 1, note: { text, font: 'wenkai', textColor: 'blue', tags: ['quote'], x: 0, y: 0, rot: 0 } }
    const { storage } = await import('/src/storage/index.ts'); await storage.putAnnotation(a)
    window.__store.setState({ annotations: [a] }); r.setAnnotations([a]); r.setOpen(true); r.advance(3)
    await window.__store.getState().reflowNotes(a.id) // Fixture represents an already laid-out note.
    await window.__store.getState().editNote(a.id); r.advance(3); r.renderNow()
    const original = r.reflow; window.__noteReflows = 0
    r.reflow = function(...args) { window.__noteReflows++; return original.apply(this, args) }
  }, initial)
  await page.waitForSelector('.note-rich-content', { visible: true })
  const content = '.note-rich-content'
  const source = () => page.evaluate(() => { const s = window.__store.getState(); return s.annotations.find(a => a.id === s.editingNote.id).note.text })
  const clear = async () => {
    await page.focus(content)
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace')
  }
  check(await source() === initial, 'opening an existing note preserves its exact Markdown without a save')
  check(await page.$$eval(content, els => els.length) === 1, 'React lifecycle creates exactly one editor')
  check(await page.$eval(content, el => ['h1', 'strong', 'em', 'del', 'code', 'ol', 'ul', 'blockquote', 'table', 'pre', 'li[data-checked="true"]'].every(s => el.querySelector(s))), 'Milkdown renders CommonMark and GFM in the editing surface')
  check(await page.$eval(content, el => !el.querySelector('script,a[href^="javascript:"]') && el.textContent.includes('<script>')), 'raw HTML stays inert and unsafe links do not execute')
  check(!await page.evaluate(() => window.unsafe), 'notes cannot execute script content')
  check(await page.$eval(content, el => !!el.querySelector('a[href="https://example.com"]')), 'existing reference links remain readable')
  check(await page.$eval(content, el => getComputedStyle(el).color === 'rgb(49, 95, 145)' && getComputedStyle(el).fontFamily.includes('LXGW')), 'reader ink and Wenkai font are inherited')
  await page.focus('[data-note-tag-input]'); await page.focus(content)
  check(await source() === initial, 'focus changes do not normalize saved Markdown')
  await page.click('[data-note-done]'); await page.waitForSelector('.note-editor', { hidden: true })
  check(await page.evaluate(() => window.__noteReflows === 0), 'opening and closing an unchanged note does not repaginate')
  await page.evaluate(() => window.__store.getState().editNote('live-markdown'))
  await page.waitForSelector(content)
  await clear()
  await page.keyboard.type('-')
  check(await page.$$eval(`${content} li`, els => els.length) === 0, 'a lone minus remains literal text')
  check(await page.$eval(content, el => el.textContent === '-'), 'minus is not replaced before the space')
  await page.keyboard.type(' ')
  await page.waitForSelector(`${content} ul > li`)
  check(await page.$eval(`${content} ul`, el => getComputedStyle(el).listStyleType === 'disc'), 'minus plus space immediately starts a real unordered list')
  const text = '有意思……国民党及共产党关于唯物史观的批评，以及对于历史和社会发展的不同理解。'.repeat(3)
  await page.keyboard.sendCharacter(text)
  const client = await page.createCDPSession()
  await client.send('Input.imeSetComposition', { text: '中文输入', selectionStart: 4, selectionEnd: 4 })
  await client.send('Input.insertText', { text: '中文输入' })
  check((await source()).includes(text + '中文输入'), 'native IME works inside the list')
  await page.evaluate(() => document.fonts.ready)
  const geometry = () => page.$eval(`${content} li`, li => {
    const p = li.querySelector(':scope > p'), text = [...p.childNodes].find(n => n.nodeType === Node.TEXT_NODE)
    const lines = []
    for (let i = 0; i < text.length; i++) {
      const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1)
      const b = r.getBoundingClientRect()
      if (!lines.some(line => Math.abs(line.top - b.top) < 1)) lines.push({ left: b.left, top: b.top })
    }
    const bullet = li.getBoundingClientRect()
    return { left: p.getBoundingClientRect().left, width: p.getBoundingClientRect().width, bullet: bullet.left, lines: lines.map(({ left }) => ({ left })) }
  })
  for (const width of [1440,390]) {
    await page.setViewport({width,height:1000})
    await new Promise(resolve => setTimeout(resolve,500))
    await page.evaluate(() => { window.__noteReflows = 0 })
    const before = await geometry()
    check(before.lines.length > 1 && before.lines.every(line => Math.abs(line.left - before.left) < 1), `wrapped text uses a hanging indent at ${width}px`)
    await page.focus('[data-note-tag-input]')
    check(JSON.stringify(await geometry()) === JSON.stringify(before), `blur does not move markers, text or wrapping at ${width}px`)
    await page.focus(content)
    check(JSON.stringify(await geometry()) === JSON.stringify(before), `refocus preserves the same list layout at ${width}px`)
  }
  // Place the caret at the list's end and notify the editor, as the browser
  // does after a user selection (DOM Range updates alone are asynchronous).
  await page.$eval(`${content} li > p`, p => {
    const range = document.createRange(); range.selectNodeContents(p); range.collapse(false)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  const beforeEnter = await geometry()
  await page.keyboard.press('Enter')
  check(await page.$$eval(`${content} li`, els=>els.length) === 2, 'Enter adds another list item')
  check(JSON.stringify(await geometry()) === JSON.stringify(beforeEnter), 'adding another item does not shift the existing list')
  await page.keyboard.sendCharacter('嵌套项目')
  await page.keyboard.press('Tab')
  check(!!await page.$(`${content} ul ul`), 'Tab indents a nested list using the engine command')
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
  check(!await page.$(`${content} ul ul`), 'Shift+Tab outdents the item')
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
  check(!!await page.$(`${content} > p`), 'Enter on an empty item leaves the list')
  check(JSON.stringify(await geometry()) === JSON.stringify(beforeEnter), 'moving into the next paragraph does not change list geometry')
  await page.keyboard.sendCharacter('继续编辑')
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control')
  check(!(await source()).includes('继续编辑'), 'undo uses the editor history')
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
  check((await source()).includes('继续编辑'), 'redo restores the edit')
  await page.waitForSelector('.note-save-state[data-save-state="saved"]')
  check(await page.evaluate(async () => { const { storage } = await import('/src/storage/index.ts'); const s = window.__store.getState(); return (await storage.listAnnotations(s.current.meta.id))[0].note.text === s.annotations[0].note.text }), 'rich edits autosave as Markdown')
  check(await page.evaluate(() => window.__noteReflows === 0), 'editing and focus changes do not repaginate the book')
  await page.screenshot({path:'/tmp/milkdown-note-mobile.png'})
  await page.keyboard.sendCharacter('立即保存')
  check((await source()).endsWith('继续编辑立即保存'), 'caret remains in the final paragraph after list edits and autosave')
  const saved = await source()
  await page.click('[data-note-done]'); await page.waitForSelector('.note-editor', {hidden:true})
  check(await page.evaluate(()=>window.__store.getState().annotations[0].note.text.includes('立即保存')), 'Done retains the last keystroke without waiting for a debounce')
  await page.evaluate(() => window.__store.getState().editNote('live-markdown'))
  await page.waitForSelector(content)
  check(await source() === saved, 'reopening retains the edited Markdown')
  await clear(); await page.keyboard.type('**实时加粗**')
  await page.waitForSelector(`${content} strong`)
  check(!!await page.$(`${content} strong`), 'Markdown input rules format bold text directly')
  await replaceNote(page, '| A | B |\n| - | - |\n| 内容 | 说明 |')
  await page.waitForSelector(`${content} table`)
  await page.click(`${content} td`); await page.keyboard.sendCharacter('补')
  check((await source()).includes('补'), 'GFM tables remain editable')
  await replaceNote(page, '![remote](https://note-tracker.invalid/image.png)\n\n<script>window.unsafe = true</script>')
  check(!await page.$(`${content} img[src]`) && !await page.evaluate(()=>window.unsafe), 'images remain links and HTML remains inert after paste')
  await clear(); check(await source() === '', 'empty/tag-only notes save an empty string')
  await page.keyboard.sendCharacter('a'.repeat(10001))
  check((await source()).length <= 10000, 'the existing note length limit rejects oversized input')
  await clear(); await page.keyboard.type('-'); await page.keyboard.type('x')
  check(!await page.$(`${content} li`), 'minus without a space stays ordinary text')
  const beforeLocale = await source()
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage',{key:'ir:locale',newValue:'en'})))
  await page.waitForSelector(`${content}[aria-label="Note text"]`)
  check(await source() === beforeLocale, 'locale switching preserves the document')
  await page.focus(content); await page.keyboard.press('Escape'); await page.waitForSelector('.note-editor',{hidden:true})
  check(errors.length === 0 && consoleErrors.length === 0, `no runtime errors: ${[...errors,...consoleErrors].join('; ')}`)
} catch (error) {
  console.log('EDITOR', await page.$eval('.note-live-editor', el=>el.innerHTML).catch(()=>'closed'))
  await page.screenshot({path:'/tmp/milkdown-note-failure.png'}); throw error
} finally { await browser.close() }
