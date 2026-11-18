// Run against VITE_BACKEND=local npm run dev. Fixtures stay in memory in a fresh
// browser profile; opening/deleting a fixture never touches account or local data.
// PUPPETEER_CORE=<module path> CHROME_BIN=<chromium> node scripts/check-shelf-browsing.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.setDefaultTimeout(60000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const check = (value, label) => { assert.ok(value, label); console.log('PASS', label) }
const fixture = async () => {
  await page.waitForFunction(() => window.__store?.getState().session.status === 'local')
  await page.evaluate(() => {
    const titles = ['The Art of Reading', '山间阅读札记', 'Invisible Cities', '人类群星闪耀时', 'A Room of One’s Own', 'The Order of Time']
    const authors = ['Robert Macfarlane', '汪曾祺', 'Italo Calvino', '斯蒂芬·茨威格', 'Virginia Woolf', 'Carlo Rovelli']
    const library = Array.from({ length: 500 }, (_, i) => ({ id: `shelf-test-${i}`, title: `${titles[i % 6]} · ${i + 1}`, author: authors[i % 6], addedAt: i, language: 'en' }))
    library[0].title = '五四运动史：现代中国的知识革命（史家巨擘弃政从学的心血之作，关于时代与知识的长篇书名）'.repeat(2)
    const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260"><rect width="180" height="260" fill="#294a3d"/><rect x="12" y="12" width="156" height="236" fill="none" stroke="#d9d2b2"/><text x="90" y="120" text-anchor="middle" fill="#e5dfc4" font-size="18">READING</text></svg>')
    library.forEach((book, i) => { if (i % 3 === 0) book.coverDataUrl = cover })
    library[1].coverDataUrl = 'data:image/png;base64,invalid'
    library[498] = { ...library[498], title: '命运攸关的抉择', author: '伊恩·克肖' }
    library[499] = { ...library[499], title: 'Ａ Quiet Library', author: 'Ursula Le Guin' }
    window.__store.setState({ library, current: null, loading: null, error: null,
      openFromLibrary: async id => { window.__openedBook = id },
      removeBook: async id => window.__store.setState({ library: window.__store.getState().library.filter(b => b.id !== id) }),
    })
  })
  await page.waitForSelector('.shelf-book-open')
}
const search = async text => {
  await page.focus('.shelf-search input')
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.sendCharacter(text)
}
const count = () => page.$$eval('.shelf-book-open', books => books.length)
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5173/shelf', { waitUntil: 'networkidle0' })
  await fixture()
  check(await count() === 60, 'large libraries initially render a bounded batch')
  check(await page.$eval('.shelf-books', el => getComputedStyle(el).gridTemplateColumns.split(' ').length) === 3, 'desktop compact view has three columns')
  check(await page.$eval('.shelf-book-open', el => el.getBoundingClientRect().height) <= 76, 'compact entries use short readable rows')
  check(!await page.$('.shelf-book-cover'), 'compact mode does not mount or load cover images')
  await page.click('.shelf-more button')
  check(await count() === 120, 'show more appends another batch')
  await search('quiet GUIN')
  check(await count() === 1 && await page.$eval('.shelf-count', el => el.textContent) === '1 of 500 books', 'search combines title and author across the full library, ignoring case and character width')
  check(await page.$eval('.shelf-list', el => el.scrollTop) === 0, 'search resets the scroll position')
  await page.click('.shelf-book-open')
  check(await page.evaluate(() => window.__openedBook) === 'shelf-test-499', 'filtered entries open the correct book')
  await search('  命运   克肖  ')
  check(await count() === 1, 'Chinese search tolerates extra whitespace')
  await page.click('.shelf-book-more')
  await page.click('.shelf-book-menu-delete')
  check(await page.$eval('.shelf-delete-name', el => el.textContent) === '命运攸关的抉择', 'filtered deletion targets the correct title')
  await page.click('.shelf-delete-cancel')
  check(await count() === 1, 'cancelling deletion retains the match')
  await search('no such book in this library')
  check(await count() === 0 && await page.$eval('.shelf-empty', el => el.textContent.includes('No matching books')), 'empty search results are distinguished from an empty library')
  await page.click('.shelf-empty button')
  check(await count() === 60, 'clearing search restores the initial batch')
  await page.click('.shelf-layout button:nth-child(2)')
  check(await page.$eval('.shelf', el => el.dataset.layout) === 'spacious', 'spacious cards remain available')
  check(await page.$eval('.shelf-books', el => getComputedStyle(el).gridTemplateColumns.split(' ').length) === 2, 'spacious desktop uses exactly two columns')
  await page.waitForFunction(() => document.querySelector('.shelf-book-cover img')?.naturalWidth > 0)
  await page.waitForFunction(() => !document.querySelector('.shelf-books li:nth-child(2) .shelf-book-cover img'))
  check(await page.$$eval('.shelf-book-cover', covers => covers.length) === 60, 'every card has a real cover or a fallback')
  check(await page.$eval('.shelf-books li:nth-child(2) .shelf-book-cover', e => !!e.textContent.trim()), 'a broken cover falls back to a typographic cover')
  check(await page.$eval('.shelf-books li:nth-child(3) .shelf-book-cover', e => !!e.textContent.trim()), 'a missing cover has a typographic cover')
  const cards = await page.$$eval('.shelf-books li', els => els.slice(0, 3).map(e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y } }))
  check(cards[0].y === cards[1].y && cards[0].x < cards[1].x && cards[2].y > cards[0].y, 'cards flow two per row')
  await page.click('.shelf-book-cover')
  check(await page.evaluate(() => window.__openedBook) === 'shelf-test-0', 'clicking a cover opens its book')
  await page.hover('.shelf-title-wrap')
  await page.waitForSelector('.shelf-full-title', {timeout:3000})
  check(!!await page.$('.shelf-full-title'), 'clamped multiline titles retain a full-title tooltip')
  await page.click('.shelf-book-more')
  check(await page.$eval('.shelf-book-menu', e => {const r=e.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight}), 'card actions remain inside the viewport')
  await page.click('.shelf-book-menu-info')
  check(!!await page.$('.book-info-dialog[open]'), 'card menu opens book information')
  await page.keyboard.press('Escape')
  if (process.env.SCREENSHOT_DIR) { await fs.mkdir(process.env.SCREENSHOT_DIR, {recursive:true}); await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/shelf-spacious-desktop.png`}) }

  await page.reload({ waitUntil: 'networkidle0' }); await fixture()
  check(await page.$eval('.shelf', el => el.dataset.layout) === 'spacious', 'layout preference survives reload')
  await page.setViewport({width:390,height:844})
  check(await page.$eval('.shelf-books', e => getComputedStyle(e).gridTemplateColumns.split(' ').length) === 1, 'spacious mobile keeps covers in one readable column')
  check(await page.$eval('.shelf-list', e => e.scrollWidth<=e.clientWidth), 'spacious cards fit a narrow viewport')
  await page.evaluate(() => window.__store.getState().setDesk('ash'))
  if (process.env.SCREENSHOT_DIR) await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/shelf-spacious-mobile.png`})
  await page.setViewport({width:320,height:740})
  check(await page.$eval('.shelf-list', e => e.scrollWidth<=e.clientWidth), 'spacious cards fit at 320px too')
  await page.setViewport({width:1440,height:900})

  await page.click('.shelf-layout button:first-child')
  await page.evaluate(() => window.__store.getState().setDesk('ash'))
  const output = process.env.SCREENSHOT_DIR
  if (output) { await fs.mkdir(output, { recursive: true }); await page.screenshot({ path: `${output}/shelf-desktop.png` }) }
  await page.setViewport({ width: 390, height: 844 })
  check(await page.$eval('.shelf-books', el => getComputedStyle(el).gridTemplateColumns.split(' ').length) === 1, 'mobile uses one compact column')
  check(await page.$eval('.shelf-col', el => el.scrollWidth <= el.clientWidth), 'mobile controls and titles fit without horizontal overflow')
  if (output) await page.screenshot({ path: `${output}/shelf-mobile.png` })
  await search('quiet')
  await page.keyboard.press('Escape')
  check(await count() === 60, 'Escape clears the search without triggering reader shortcuts')
  await page.evaluate(() => window.__store.getState().setDesk('ink'))
  if (output) await page.screenshot({ path: `${output}/shelf-dark.png` })
  await page.evaluate(() => window.__store.setState({ library: [] }))
  check(await page.$$eval('.shelf-sample', cards => cards.length) === 2, 'empty guest libraries retain both sample cards')
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
