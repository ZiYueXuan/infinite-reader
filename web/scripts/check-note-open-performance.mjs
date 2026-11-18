// Local synthetic long book; no account data or cloud writes. Run against Vite with VITE_BACKEND=local.
import assert from 'node:assert/strict'
import { replaceNote } from './note-editor-helpers.mjs'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } })
try {
  const page = await browser.newPage(), errors = []
  page.setDefaultTimeout(120000); page.on('pageerror', e => errors.push(e.message))
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5201/?sample=zh&lang=en', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading)
  const book = await page.evaluate(async () => {
    const store = window.__store, s = store.getState(), r = window.__reader, parsed = s.current.parsed
    const original = parsed.chapters.filter(c => c.blocks.some(b => b.kind === 'p' && b.text.length > 20))
    const chars = original.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.text.length, 0), 0)
    const copies = Math.ceil(500000 / chars)
    const chapters = Array.from({ length: copies }, () => original).flat().map((c, index) => ({ ...c, index }))
    store.setState({ current: { ...s.current, parsed: { ...parsed, chapters } }, annotations: [], turnHintSeen: true, tiltHintSeen: true })
    r.setAnnotations([])
    await store.getState().reflowNotes() // Load the full long book before measuring clicks.
    const block = chapters[0].blocks.find(b => b.kind === 'p' && b.text.length > 20)
    const a = { id: 'perf-note', bookId: s.current.meta.id, locator: { chapter: 0, start: block.start, end: block.start + 10 },
      quote: block.text.slice(0, 10), kind: 'highlight', color: 'pink', createdAt: 1, updatedAt: 1 }
    store.setState({ annotations: [a] }); r.setAnnotations([a]); r.revealLocator(a.locator); r.advance(3); r.renderNow()
    window.perf = { reflows: 0, originalPagination: r.pagination, originalBook: r.book }
    const reflow = r.reflow
    r.reflow = function (...args) {
      const programs = this.renderer.info.programs.filter(p => p.cacheKey.includes('paper-leaf-v5'))
      const result = reflow.apply(this, args)
      window.perf.reflows++
      window.perf.programsReused = programs.length > 0 && programs.every(p => this.renderer.info.programs.includes(p))
      window.perf.renderedMs = performance.now() - window.perf.doneStart
      window.perf.noteHit = !!document.querySelector('.inline-note-hit')
      requestAnimationFrame(() => { window.perf.frameMs = performance.now() - window.perf.doneStart })
      return result
    }
    document.addEventListener('click', event => {
      if (event.target.closest('[aria-label="Add inline note"],[aria-label="Edit inline note"]')) window.perf.start = performance.now()
      if (event.target.closest('[data-note-done]')) window.perf.doneStart = performance.now()
    }, true)
    // Hold the persistence promise to prove that opening and typing are independent of disk/network latency.
    const { storage } = await import('/src/storage/index.ts'), put = storage.putAnnotation
    let release; const gate = new Promise(resolve => { release = resolve }), writes = []
    storage.putAnnotation = a => { const pending = gate.then(() => put(a)); writes.push(pending); return pending }
    window.releaseNoteWrites = async () => { storage.putAnnotation = put; release(); await Promise.all(writes) }
    store.setState({ popover: { kind: 'mark', id: a.id, rect: { left: 450, top: 450, width: 180, height: 24 } } })
    return { chars: chars * copies, pages: r.pagination.pages.length }
  })
  await page.click('[aria-label="Add inline note"]')
  await page.waitForSelector('.note-rich-content', { visible: true })
  const latency = await page.evaluate(() => performance.now() - window.perf.start)
  assert.ok(latency < 1500, `Editor took ${latency}ms to become editable`)
  assert.ok(await page.evaluate(() => window.perf.reflows === 0 && window.perf.originalPagination === window.__reader.pagination && window.perf.originalBook === window.__reader.book))
  await replaceNote(page, 'A draft typed while storage is pending.')
  await page.evaluate(() => window.__store.getState().addNoteToMark('perf-note'))
  assert.equal(await page.evaluate(() => window.__store.getState().annotations[0].note.text), 'A draft typed while storage is pending.')
  await page.evaluate(() => window.releaseNoteWrites())
  assert.equal(await page.evaluate(() => window.perf.reflows), 0)
  console.log(`PASS ${book.chars} characters / ${book.pages} pages: editable in ${latency.toFixed(1)}ms with persistence held; no pagination/model rebuild; repeated add preserves draft`)
  await page.click('[data-note-done]')
  await page.waitForFunction(async () => {
    const { noteLayoutSignature } = await import('/src/book/annotations.ts')
    return window.__reader.pagination.noteSignature === noteLayoutSignature(window.__store.getState().annotations)
  })
  assert.equal(await page.evaluate(() => window.perf.reflows), 1)
  await page.waitForFunction(() => window.perf.frameMs !== undefined)
  const commit = await page.evaluate(() => ({ renderedMs: window.perf.renderedMs, frameMs: window.perf.frameMs,
    noteHit: window.perf.noteHit, programsReused: window.perf.programsReused }))
  assert.ok(commit.noteHit, 'The completed note has a visible spread hit target')
  assert.ok(commit.programsReused, 'Paper GPU programs survive the model replacement')
  assert.ok(commit.renderedMs < 1500, `Done to rendered note took ${commit.renderedMs}ms`)
  console.log(`PASS Done to rendered note ${commit.renderedMs.toFixed(1)}ms; next frame ${commit.frameMs.toFixed(1)}ms; paper programs reused`)
  await page.evaluate(() => window.__store.setState({ popover: { kind: 'mark', id: 'perf-note', rect: { left: 450, top: 450, width: 180, height: 24 } } }))
  await page.click('[aria-label="Edit inline note"]')
  await page.waitForSelector('.note-rich-content', { visible: true })
  const reopen = await page.evaluate(() => performance.now() - window.perf.start)
  await page.click('[data-note-done]')
  assert.equal(await page.evaluate(() => window.perf.reflows), 1)
  console.log(`PASS Done lays out the note once; unchanged reopen (${reopen.toFixed(1)}ms) / close does not repaginate`)
  // Start a real pending layout, then reopen. The older result must not rebuild the book under the editor.
  await page.evaluate(async () => {
    const pending = window.__store.getState().reflowNotes('perf-note')
    await window.__store.getState().editNote('perf-note')
    await pending
  })
  assert.equal(await page.evaluate(() => window.perf.reflows), 1)
  assert.equal(await page.evaluate(() => window.__store.getState().editingNote.id), 'perf-note')
  assert.deepEqual(errors, [])
  console.log('PASS reopening cancels stale note layout; no runtime errors')
} finally { await browser.close() }
