// Regression: annotation / sticky-note / reading-progress writes must survive an immediate reload or close.
//
// Live finding: create a sticky note and reload before the 350 ms debounced save ran -> the note was gone after reload (the
// flush on pagehide used ordinary fetches that the browser cancels during unload, and the multi-step create was awaited
// sequentially). Fixed by: a write-ahead outbox (IndexedDB + localStorage mirror) replayed on next load, keepalive requests
// started synchronously on pagehide / beforeunload / visibilitychange(hidden), and a short debounce for creates.
//
// The script starts a mock of the Worker API (same routes as worker/API.md: cookie-less session stub, same-origin Origin check,
// 409 on reused client ids, PATCH/PUT/DELETE) and a Vite dev server proxying /api to it, then drives real headless Chrome.
//
//   PUPPETEER_CORE=<puppeteer-core> CHROME_BIN=/usr/local/bin/google-chrome node scripts/check-note-reload.mjs
// Exits non-zero on failure. (Needs port 5177 and 8799, override with VITE_PORT / MOCK_PORT.)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VITE_PORT = +(process.env.VITE_PORT || 5177)
const MOCK_PORT = +(process.env.MOCK_PORT || 8799)
const LATENCY = +(process.env.MOCK_LATENCY_MS || 120)

/* ------------------------------ mock Worker API ------------------------------ */
const sampleSize = fs.statSync(path.join(WEB, 'public/samples/alice.epub')).size
const db = { books: [], anns: {}, notes: {}, progress: {} }
const reqLog = []
let down = false
let badOrigin = 0
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('close', () => {
    // a request the client aborted before the body arrived is never processed (like a cancelled fetch)
    if (!req.complete) reqLog.push(`ABORTED ${req.method} ${req.url}`)
  })
  req.on('end', async () => {
    if (down) return req.socket.destroy()
    const url = new URL(req.url, 'http://x')
    const p = url.pathname.replace(/^\/api/, '')
    const m = req.method
    reqLog.push(`${m} ${p}`)
    await sleep(LATENCY)
    const send = (o, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    const err = (status, code) => send({ error: { code, message: code } }, status)
    const origin = req.headers.origin
    if (m !== 'GET' && origin && origin !== `http://127.0.0.1:${MOCK_PORT}`) {
      badOrigin++
      return err(403, 'bad_origin')
    }
    const raw = Buffer.concat(chunks).toString()
    const body = () => {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    if (p === '/auth/me') return send({ user: { id: 'u1', email: 'me@example.com', name: null, avatar_url: null } })
    if (p === '/auth/providers') return send({ email: true, google: false })
    if (p === '/books' && m === 'GET') return send({ books: db.books.map(b => ({ ...b, progress: db.progress[b.id] ?? null })) })
    if (/^\/books\/[^/]+\/file$/.test(p) && m === 'GET') {
      res.writeHead(200, { 'content-type': 'application/epub+zip' })
      return res.end(fs.readFileSync(path.join(WEB, 'public/samples/alice.epub')))
    }
    if (p === '/books' && m === 'POST') {
      const b = { id: 'srv0abcdef', title: 'Alice', author: 'x', language: 'en', filename: 'alice.epub', sizeBytes: sampleSize, hasCover: false, status: 'ready', chapterCount: 1, chunkCount: 1, indexedChunks: 1, progress: null, createdAt: Date.now() }
      db.books = [b]
      return send({ book: b }, 202)
    }
    let r
    if ((r = /^\/books\/([^/]+)\/progress$/.exec(p)) && m === 'PUT') {
      db.progress[r[1]] = body()
      return send({ ok: true })
    }
    if ((r = /^\/books\/([^/]+)\/(annotations|notes)$/.exec(p))) {
      const coll = r[2] === 'annotations' ? db.anns : db.notes
      if (m === 'GET') return send({ [r[2]]: Object.values(coll).filter((x) => x.bookId === r[1]) })
      const b = body()
      if (!b || !b.id || b.id.length < 8) return err(400, 'invalid_request')
      if (coll[b.id]) return err(409, 'conflict')
      coll[b.id] = { ...b, bookId: r[1], createdAt: Date.now(), updatedAt: Date.now() }
      return send({ [r[2] === 'annotations' ? 'annotation' : 'note']: coll[b.id] }, 201)
    }
    if ((r = /^\/books\/([^/]+)\/(annotations|notes)\/(.+)$/.exec(p))) {
      const coll = r[2] === 'annotations' ? db.anns : db.notes
      const cur = coll[r[3]]
      if (!cur) return err(404, 'not_found')
      if (m === 'DELETE') {
        delete coll[r[3]]
        return send({ ok: true })
      }
      if (m === 'PATCH') {
        Object.assign(cur, body(), { updatedAt: Date.now() })
        return send({ ok: true })
      }
    }
    return err(404, 'not_found')
  })
})
await new Promise((r) => server.listen(MOCK_PORT, '127.0.0.1', r))

/* --------------------------------- dev server -------------------------------- */
const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
  cwd: WEB,
  env: { ...process.env, API_PROXY: `http://127.0.0.1:${MOCK_PORT}`, VITE_BACKEND: '' },
  stdio: 'ignore',
})
const stop = async () => {
  vite.kill()
  server.close()
}
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://localhost:${VITE_PORT}/`)).ok) break
  } catch {
    /* not up yet */
  }
  await sleep(200)
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 800 },
})
const page = await browser.newPage()
const logs = []
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
let fails = 0
const fail = (m) => {
  fails++
  console.log('FAIL', m)
}
const ok = (m) => console.log('ok  ', m)
const URL_ = `http://localhost:${VITE_PORT}/?sample`
const bookReady = () => page.waitForFunction('window.__reader&&window.__reader.hasBook&&window.__store&&window.__store.getState().current&&window.__store.getState().session.status==="user"', { timeout: 120000 }).catch(async error => {
  console.log('book readiness diagnostics:', await page.evaluate(() => { const s = window.__store?.getState(); return { url: location.href, session: s?.session, error: s?.error, loading: s?.loading, current: s?.current?.meta, hasBook: window.__reader?.hasBook } }), reqLog.slice(-20), logs)
  throw error
})
const reload = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await bookReady()
  await sleep(300)
}
const annotations = () => page.evaluate('window.__store.getState().annotations.map(a=>({id:a.id,text:a.note&&a.note.text,hasNote:!!a.note,color:a.color}))')
const mark = (q, text, color = 'yellow') =>
  `(()=>{const S=window.__store;S.setState({popover:{kind:'selection',rect:{left:100,top:100,width:50,height:20},locator:{chapter:1,start:${q},end:${q + 14}},text:${JSON.stringify(text)}}});return S.getState().mark('highlight','${color}',true)})()`
// the tail of the server's note/annotation view
const serverNotes = () => Object.values(db.notes).map((n) => ({ id: n.id, text: n.text }))
const waitFor = async (fn, ms = 4000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await fn()) return true
    await sleep(50)
  }
  return false
}

await page.goto(URL_, { waitUntil: 'domcontentloaded' })
await bookReady()
await page.evaluate('window.__reader.setOpen(true); window.__reader.advance(2.5)')
await sleep(500)

/** create a note, wait `gap` ms, reload, then check store + (eventually) the server */
const scenario = async (name, { gap, edit, quote }) => {
  const before = await annotations()
  await page.evaluate(mark(quote, 'Alice ' + name))
  const id = (await annotations()).find((a) => !before.some((b) => b.id === a.id))?.id
  if (!id) return fail(`${name}: no annotation created`)
  if (edit) await page.evaluate(`window.__store.getState().updateNoteText(${JSON.stringify(id)}, ${JSON.stringify(edit)})`)
  if (gap) await sleep(gap)
  const mark0 = reqLog.length
  await reload()
  if (gap === 0) {
    // the unload keepalive requests (not just the replay on the next load) must have reached the server before the new page asked who it is
    const meIdx = reqLog.findIndex((l, i) => i >= mark0 && l === 'GET /auth/me')
    const noteIdx = reqLog.findIndex((l, i) => i >= mark0 && (l === 'POST /books/srv0abcdef/notes' || l === `PATCH /books/srv0abcdef/notes/n_${id}`))
    if (noteIdx === -1 || (meIdx !== -1 && noteIdx > meIdx)) fail(`${name}: note write was not sent by the unload flush (note at ${noteIdx}, next page /auth/me at ${meIdx})`)
    else ok(`${name}: note write sent during unload (keepalive)`)
  }
  const after = await annotations()
  const mine = after.find((a) => a.id === id)
  if (!mine || !mine.hasNote) fail(`${name}: note missing in the reader after reload (${JSON.stringify(after.length)} annotations)`)
  else if (edit && mine.text !== edit) fail(`${name}: note text after reload is "${mine.text}", expected "${edit}"`)
  else ok(`${name}: note present after reload`)
  // everything must also reach the server (via keepalive or replay)
  const synced = await waitFor(() => db.anns[id] && db.notes['n_' + id] && (!edit || db.notes['n_' + id].text === edit))
  if (!synced) fail(`${name}: server never got the note (${JSON.stringify(serverNotes())})`)
  else ok(`${name}: server has the note${edit ? ' with its text' : ''}`)
  return id
}

await scenario('reload at once', { gap: 0, quote: 10 })
await scenario('reload 15 ms after create', { gap: 15, quote: 40 })
await scenario('reload while create request is in flight', { gap: 60 + 0, quote: 70 })
await scenario('typed text, reload at once', { gap: 0, edit: 'remember this', quote: 100 })
await scenario('typed text, reload 200 ms later', { gap: 200, edit: 'second note text', quote: 130 })

// restyle + move without waiting
{
  const id = (await annotations())[0].id
  await page.evaluate(`window.__store.getState().restyle(${JSON.stringify(id)}, { color: 'pink' })`)
  await reload()
  const c = (await annotations()).find((a) => a.id === id)?.color
  if (c !== 'pink') fail(`restyle then reload: colour is ${c}`)
  else ok('restyle then reload: colour kept')
  if (!(await waitFor(() => db.anns[id]?.color === 'pink'))) fail('restyle never reached the server')
  else ok('restyle reached the server')
}

// delete right before reload
{
  const id = (await annotations()).at(-1).id
  await page.evaluate(`window.__store.getState().removeMark(${JSON.stringify(id)})`)
  await reload()
  if ((await annotations()).some((a) => a.id === id)) fail('deleted mark came back after reload')
  else ok('deleted mark stays deleted after reload')
  if (!(await waitFor(() => !db.anns[id] && !db.notes['n_' + id]))) fail('delete never reached the server')
  else ok('delete reached the server')
}

// progress: turn a page and reload before the 700 ms progress debounce
{
  delete db.progress.srv0abcdef
  await page.evaluate('window.__reader.setOpen(true); window.__reader.advance(2.5)')
  await page.evaluate('window.__reader.turn(1); window.__reader.advance(2.5)')
  const turned = await page.evaluate('window.__store.getState().turned')
  await sleep(50)
  await reload()
  if (!(await waitFor(() => db.progress.srv0abcdef?.location?.leaf === turned && turned > 0))) fail(`reading progress lost on immediate reload (turned ${turned}, server ${JSON.stringify(db.progress.srv0abcdef)})`)
  else ok('reading progress survived an immediate reload: ' + JSON.stringify(db.progress.srv0abcdef))
}

// Autosave is observable and bounded even while the editor remains open and typing never pauses.
{
  const id = (await annotations())[0].id
  await page.evaluate(async id => { await window.__store.getState().editNote(id) }, id)
  await page.waitForSelector('.note-save-state')
  await page.evaluate(id => {
    let n = 0
    window.__autosaveTyping = setInterval(() => void window.__store.getState().updateNoteText(id, `continuous draft ${++n}`), 100)
  }, id)
  const duringTyping = await waitFor(() => db.notes['n_' + id]?.text.startsWith('continuous draft '), 3500)
  await page.evaluate(() => clearInterval(window.__autosaveTyping))
  if (duringTyping) ok('continuous typing syncs before the user pauses or clicks Done')
  else fail('continuous typing never reached the server within the maximum wait')
  await page.evaluate(id => window.__store.getState().updateNoteText(id, '**final autosaved draft**'), id)
  if (await page.$eval('.note-save-state', el => el.dataset.saveState === 'saving')) ok('editor reports a pending save until the server acknowledges')
  else fail('editor did not report the pending save')
  if (await waitFor(() => db.notes['n_' + id]?.text === '**final autosaved draft**')) ok('latest Markdown source is saved with the editor still open')
  else fail('latest draft did not reach the server')
  await page.waitForSelector('.note-save-state[data-save-state="saved"]')
  if (await page.evaluate(() => !!window.__store.getState().editingNote)) ok('autosaving never closes the editor')
  else fail('autosaving closed the editor')

  down = true
  await page.evaluate(id => window.__store.getState().updateNoteText(id, 'draft while disconnected'), id)
  await page.waitForSelector('.note-save-state[data-save-state="error"]')
  ok('failed cloud write is shown as unsynced, not saved')
  down = false
  await page.click('.note-save-state button')
  await page.waitForSelector('.note-save-state[data-save-state="saved"]')
  if (db.notes['n_' + id]?.text === 'draft while disconnected') ok('manual retry saves the latest draft')
  else fail('retry did not save the latest draft')

  down = true
  await page.evaluate(id => window.__store.getState().updateNoteText(id, 'online recovery draft'), id)
  await page.waitForSelector('.note-save-state[data-save-state="error"]')
  down = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForSelector('.note-save-state[data-save-state="saved"]')
  if (db.notes['n_' + id]?.text === 'online recovery draft') ok('network restoration replays the pending draft without a reload')
  else fail('network restoration did not replay the pending draft')
  await page.click('[data-note-done]')
}

// server unreachable at unload and on the next load: the note must stay visible and sync once the server is back
{
  const before = await annotations()
  down = true
  await page.evaluate(mark(160, 'Alice offline'))
  const id = (await annotations()).find((a) => !before.some((b) => b.id === a.id))?.id
  await sleep(300)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction('window.__reader&&window.__store', { timeout: 120000 })
  await sleep(1500)
  down = false
  // An offline server book may return to Shelf; reopen the same fixture after auth recovers.
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await bookReady()
  await sleep(300)
  const mine = (await annotations()).find((a) => a.id === id)
  if (!mine?.hasNote) fail('offline: note not shown after the server came back')
  else ok('offline: note shown after the server came back')
  if (!(await waitFor(() => db.anns[id] && db.notes['n_' + id], 6000))) fail('offline: note was never replayed to the server')
  else ok('offline: note replayed to the server on a later load')
}

// confirmed writes are dropped from the write-ahead log (no endless replays)
{
  await reload()
  const empty = await waitFor(() => page.evaluate(`JSON.parse(localStorage.getItem('infinite-reader:outbox:v1')||'[]').length===0`), 6000)
  if (!empty) fail('outbox still holds entries after everything was confirmed')
  else ok('outbox is empty once the server confirmed everything')
}

if (badOrigin) fail(`${badOrigin} request(s) were rejected by the Origin check`)
const aborted = reqLog.filter((l) => l.startsWith('ABORTED'))
console.log('requests:', reqLog.length, 'aborted before arrival:', aborted.length)
if (logs.length) console.log('page errors:', logs.join('\n'))
await browser.close()
await stop()
if (fails) {
  console.log(`FAILED (${fails})`)
  process.exit(1)
}
console.log('PASS')
process.exit(0)
