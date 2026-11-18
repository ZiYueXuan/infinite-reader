import { noteSource, replaceNote, scanNotePreview } from './note-editor-helpers.mjs'
// Local sample, real 3D note ink and editor. No cloud writes or AI calls.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 900 } })
const page = await browser.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(60000)
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
const text = '# 阅读笔记\n\n**引经据典**，*对仗*，~~删去~~与 `code`。\n\n1. 第一项\n2. 第二项\n   - 子项\n\n- [x] 已读\n\n> 这是引用\n\n| 观点 | 说明 |\n| --- | --- |\n| 内容 | **清晰** |\n\n[参考](https://example.com)\n\n```js\n  const x = 1\n```\n\n<script>window.unsafe = true</script>\n\n[危险](javascript:alert)' + '\n\n' + '跨页内容。'.repeat(200)
const settle = () => page.evaluate(() => { window.__reader.advance(3); window.__reader.renderNow() })
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5179/?sample=zh', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  await page.evaluate(async text => {
    const s = window.__store.getState(), r = window.__reader
    const c = s.current.parsed.chapters.find(c => c.blocks.some(b => b.kind === 'p' && b.text.length > 20))
    const b = c.blocks.find(b => b.kind === 'p' && b.text.length > 20)
    const a = { id: 'markdown-note', bookId: s.current.meta.id, locator: { chapter: c.index, start: b.start, end: b.start + 12 }, quote: b.text.slice(0, 12), kind: 'highlight', color: 'yellow', createdAt: 1, updatedAt: 1, note: { text, tags: ['quote'], font: 'wenkai', textColor: 'blue', x: 0, y: 0, rot: 0 } }
    window.__store.setState({ annotations: [a] }); r.setAnnotations([a]); r.setOpen(true); r.advance(3)
    await window.__store.getState().reflowNotes(a.id)
    window.__store.getState().editNote(a.id)
  }, text)
  await settle()
  await page.waitForSelector('.note-rich-content', { visible: true })
  check((await noteSource(page)) === text, 'editing preserves exact Markdown source')
  await page.focus('[data-note-tag-input]')
  await page.$eval('.note-live-editor', el => { el.scrollTop = 0 })
  await page.waitForSelector('.note-rich-content')
  const rendered = await scanNotePreview(page, ['h1', 'strong', 'em', 'del', 'code', 'ol', 'ul', 'blockquote', 'table', 'pre', 'input[type=checkbox]'])
  check(rendered.all, 'live blocks render headings, rich text, nested lists, tasks, quotes, tables and code')
  check(!rendered.unsafe && rendered.literalHtml, 'HTML stays literal and unsafe URLs are not clickable')
  check(await page.evaluate(() => !window.unsafe), 'preview cannot execute note HTML')
  check(await page.$eval('.note-live-editor', el => getComputedStyle(el).color === 'rgb(49, 95, 145)' && getComputedStyle(el).fontFamily.includes('LXGW')), 'preview retains selected note ink and font')
  if (process.env.NOTE_MARKDOWN_SHOTS) await page.screenshot({ path: '/tmp/note-markdown-preview.png' })
  // No edits: preview and Done must not trigger pagination or replace textures.
  await page.evaluate(() => {
    const r = window.__reader, original = r.reflow
    window.__reflows = 0
    r.reflow = function(...args) { window.__reflows++; return original.apply(this, args) }
  })
  await page.click('[data-note-done]')
  await page.waitForFunction(() => !window.__store.getState().editingNote)
  check(await page.evaluate(() => window.__reflows === 0), 'preview then Done without edits causes no reflow')
  check(await page.evaluate(() => {
    const notes = window.__reader.pagination.pages.flatMap(p => p.notes ?? [])
    const words = notes.flatMap(n => n.lines.flatMap(l => l.words))
    return notes.length > 1 && words.some(w => w.noteStrike) && words.some(w => w.noteCode) && words.some(w => w.noteLink) && words.every(w => w.s === -1 && w.e === -1)
  }), 'saved Markdown is rich page ink across fragments, without chapter offsets')
  await page.evaluate(() => window.__reader.tex.setMarks(window.__store.getState().annotations))
  await page.waitForFunction(() => {
    const r = window.__reader
    return Object.values(r.visiblePages).filter(p => p >= 0).every(p => r.tex.get(p).image instanceof ImageBitmap)
  })
  check(true, 'rich Markdown notes paint successfully in the background worker')
  await settle()
  if (process.env.NOTE_MARKDOWN_SHOTS) await page.screenshot({ path: '/tmp/note-markdown-page.png' })
  await page.evaluate(() => window.__store.getState().editNote('markdown-note'))
  await page.waitForSelector('.note-rich-content')
  check((await noteSource(page)) === text, 'reopening returns to the unchanged source')
  await page.focus('.note-rich-content')
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await replaceNote(page, '**链接测试** [参考](https://example.com)')
  await page.click('[data-note-done]')
  await page.waitForFunction(() => window.__reader.pagination.pages.flatMap(p => p.notes ?? []).filter(n => n.id === 'markdown-note').length === 1)
  await settle()
  await page.waitForSelector('.inline-note-link-hit', { visible: true })
  check(await page.$eval('.inline-note-link-hit', el => {
    window.open = (...args) => { window.__openedLink = args; return null }
    el.click()
    return window.__openedLink[0] === 'https://example.com' && window.__openedLink[2] === 'noopener,noreferrer' && !window.__store.getState().editingNote
  }), 'saved note link opens safely without opening its editor')
  check(await page.$eval('.inline-note-link-hit', el => {
    const r = window.__reader, before = r.view.tzoom
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -8 })
    el.dispatchEvent(e)
    return e.defaultPrevented && r.view.tzoom > before
  }), 'pinch over a Markdown link zooms the reader')
  await page.$eval('.inline-note-tag-hit', el => el.click())
  await page.waitForSelector('.tag-notes-dialog')
  check(await page.$eval('.tag-notes-dialog', el => !!el.querySelector('.note-markdown strong') && !!el.querySelector('.note-markdown a')), 'same-tag overlay also renders Markdown')
  await page.keyboard.press('Escape')
  // Compact viewport: preview is scrollable while Done and tags stay reachable.
  await page.setViewport({ width: 390, height: 720 })
  await page.evaluate(() => window.__store.getState().editNote('markdown-note'))
  await page.waitForSelector('.note-rich-content', { visible: true })
  await page.focus('[data-note-tag-input]')
  await page.$eval('.note-live-editor', el => { el.scrollTop = 0 })
  await page.waitForSelector('.note-rich-content')
  check(await page.$eval('.note-editor', el => {
    const box = el.getBoundingClientRect(), preview = el.querySelector('.note-live-editor').getBoundingClientRect(), done = el.querySelector('[data-note-done]').getBoundingClientRect()
    return box.left >= 0 && box.right <= innerWidth && preview.height > 30 && done.top >= box.top && done.bottom <= box.bottom
  }), 'mobile editor keeps preview and Done within the viewport')
  if (process.env.NOTE_MARKDOWN_SHOTS) await page.screenshot({ path: '/tmp/note-markdown-mobile.png' })
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
