// Capture the existing empty WebGL desk as lightweight shelf backgrounds.
// Run against a local preview; only bundled sample content is used, auth is mocked.
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 900 } })
try {
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', r => {
    if (new URL(r.url()).pathname.startsWith('/api/')) return void r.respond({ status: r.url().endsWith('/me') ? 401 : 200,
      contentType: 'application/json', body: r.url().endsWith('/me') ? '{"error":{"code":"unauthorized","message":"Unauthorized"}}' : '{"email":true,"google":false}' })
    void r.continue()
  })
  await page.goto(new URL('/shelf?sample=alice', process.env.READER_URL || 'http://127.0.0.1:5202').href)
  await page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading, { timeout: 120000 })
  await page.evaluate(() => window.__store.getState().returnToShelf())
  await page.addStyleTag({ content: '.app > :not(.desk) { display: none !important; }' })
  const output = new URL('../src/assets/shelf/', import.meta.url)
  await fs.mkdir(output, { recursive: true })
  for (const id of ['walnut', 'ash', 'ink', 'baize', 'stone']) {
    await page.evaluate(id => { window.__store.getState().setDesk(id); window.__reader.renderNow() }, id)
    await new Promise(resolve => setTimeout(resolve, 200))
    await page.screenshot({ path: new URL(`${id}.webp`, output).pathname, type: 'webp', quality: 65 })
  }
} finally { await browser.close() }
