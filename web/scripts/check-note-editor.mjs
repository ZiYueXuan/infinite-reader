import { noteSource, replaceNote } from './note-editor-helpers.mjs'
// Real local note editor: autosave without Done, resize, persistence and Markdown preview.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } })
const page = await browser.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
page.setDefaultTimeout(60000)
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS', label) }
const ready = () => page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
const rect = () => page.$eval('.note-editor', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5183/?sample=zh', { waitUntil: 'domcontentloaded' })
  await ready()
  await page.evaluate(async () => {
    const s = window.__store.getState(), r = window.__reader
    const c = s.current.parsed.chapters.find(c => c.blocks.some(b => b.kind === 'p' && b.text.length > 20))
    const b = c.blocks.find(b => b.kind === 'p' && b.text.length > 20)
    const a = { id: 'resize-note', bookId: s.current.meta.id, locator: { chapter: c.index, start: b.start, end: b.start + 10 }, quote: b.text.slice(0, 10), kind: 'highlight', color: 'blue', createdAt: 1, updatedAt: 1, note: { text: 'initial', font: 'inherit', tags: ['test'], x: 0, y: 0, rot: 0 } }
    const { storage } = await import('/src/storage/index.ts')
    await storage.putAnnotation(a)
    window.__store.setState({ annotations: [a] }); r.setAnnotations([a]); r.setOpen(true); r.advance(3)
    await window.__store.getState().editNote(a.id)
    r.advance(3); r.renderNow()
    const reflow = r.reflow
    window.__editorReflows = 0
    r.reflow = function(...args) { window.__editorReflows++; return reflow.apply(this, args) }
  })
  await page.waitForSelector('.note-rich-content', { visible: true })
  await page.focus('.note-rich-content')
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  const inputDraft = '# 实时笔记\n\n**不用点击完成也保存**\n\n- 一\n- 二'
  await replaceNote(page, inputDraft)
  const draft = await noteSource(page)
  await page.waitForSelector('.note-save-state[data-save-state="saved"]')
  check(await page.evaluate(async draft => {
    const { storage } = await import('/src/storage/index.ts')
    const s = window.__store.getState()
    return !!s.editingNote && (await storage.listAnnotations(s.current.meta.id)).find(a => a.id === 'resize-note')?.note?.text === draft
  }, draft), 'Markdown source persists while editor stays open, without clicking Done')
  const before = await rect()
  const grip = await page.$('[data-note-resize]'), box = await grip.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 120, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(before => { const r = document.querySelector('.note-editor').getBoundingClientRect(); return r.width > before.width + 50 && r.height > before.height + 50 }, {}, before)
  const expanded = await rect()
  check(Math.abs(expanded.x - before.x) < 1 && Math.abs(expanded.y - before.y) < 1, 'drag resize keeps the top-left corner fixed')
  check((await noteSource(page)) === draft, 'resizing preserves the Markdown draft')
  await page.focus('[data-note-tag-input]')
  await page.$eval('.note-live-editor', el => { el.scrollTop = 0 })
  await page.waitForSelector('.note-rich-content')
  check(await page.$eval('.note-live-editor', el => !!el.querySelector('h1') && !!el.querySelector('strong')), 'resized editor still renders Markdown preview')
  await page.focus('[data-note-resize]')
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(w => document.querySelector('.note-editor').getBoundingClientRect().width < w - 10, {}, expanded.width)
  const preferred = await rect()
  check(await page.evaluate(() => window.__editorReflows === 0), 'typing, resizing and preview do not repaginate the book')
  // Reload while editing, with no Done action.
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready()
  check(await page.evaluate(draft => window.__store.getState().annotations.find(a => a.id === 'resize-note')?.note?.text === draft, draft), 'reload before Done restores the autosaved draft')
  await page.evaluate(async () => { await window.__store.getState().editNote('resize-note'); window.__reader.advance(3); window.__reader.renderNow() })
  await page.waitForSelector('.note-rich-content', { visible: true })
  const reopened = await rect()
  check(Math.abs(reopened.width - preferred.width) < 1 && Math.abs(reopened.height - preferred.height) < 1, 'manual editor size is remembered across reloads')
  await page.setViewport({ width: 390, height: 720 })
  await page.waitForFunction(() => { const r = document.querySelector('.note-editor').getBoundingClientRect(); return r.x >= 12 && r.right <= innerWidth - 12 && r.bottom <= innerHeight - 12 })
  check(true, 'remembered dimensions are clamped to a smaller viewport')
  await page.setViewport({ width: 1440, height: 1000 })
  await page.waitForFunction(width => Math.abs(document.querySelector('.note-editor').getBoundingClientRect().width - width) < 1, {}, preferred.width)
  await page.click('[data-note-resize]', { count: 2 })
  await page.waitForFunction(() => !localStorage.getItem('ir:note-editor-size'))
  check((await rect()).width <= 520, 'double-click resets to the default editor size')
  if (process.env.NOTE_EDITOR_SHOTS) await page.screenshot({ path: '/tmp/note-editor-autosave.png' })
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
