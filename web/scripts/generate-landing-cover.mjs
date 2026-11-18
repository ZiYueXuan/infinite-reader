// Regenerate the single artwork used by the loading poster, static fallback and 3D cover.
// PUPPETEER_CORE=/path/to/puppeteer-core/.../puppeteer-core.js node web/scripts/generate-landing-cover.mjs
import { readFile, writeFile } from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const fontFiles = [
  ['EB Garamond Variable', 'eb-garamond', 'normal'],
  ['EB Garamond Variable', 'eb-garamond', 'italic'],
  ['Inter Variable', 'inter', 'normal'],
]
const fonts = await Promise.all(fontFiles.map(async ([family, name, style]) => ({
  family, style, data: (await readFile(new URL(`../node_modules/@fontsource-variable/${name}/files/${name}-latin-wght-${style}.woff2`, import.meta.url))).toString('base64'),
})))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const image = await page.evaluate(async fonts => {
    await Promise.all(fonts.map(async ({ family, style, data }) => {
      const font = new FontFace(family, `url(data:font/woff2;base64,${data})`, { style, weight: '400' })
      document.fonts.add(await font.load())
    }))
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1536
    const c = canvas.getContext('2d')
    c.fillStyle = '#243e35'; c.fillRect(0, 0, 1024, 1536)
    let seed = 271828
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
    c.fillStyle = 'rgba(220,235,211,.055)'
    for (let i = 0; i < 19000; i++) c.fillRect(random() * 1024, random() * 1536, 2, 2)
    c.strokeStyle = '#b8b18a'; c.lineWidth = 2; c.strokeRect(68, 68, 888, 1400); c.strokeRect(83, 83, 858, 1370)
    c.textAlign = 'center'; c.fillStyle = '#d8d1ac'; c.font = '22px "Inter Variable", sans-serif'; c.fillText('A SPACE FOR YOUR MIND', 512, 220)
    c.font = '112px "EB Garamond Variable", serif'; c.fillText('Infinite', 512, 470); c.fillText('Reader', 512, 586)
    c.lineWidth = 1.3
    for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(512, 925, 115 + i * 22, 115 + i * 22, 0, 0, Math.PI * 2); c.stroke() }
    c.font = 'italic 34px "EB Garamond Variable", serif'; c.fillText('A world within.', 512, 1290)
    return canvas.toDataURL('image/webp', .95).split(',')[1]
  }, fonts)
  await writeFile(new URL('../src/ui/landing-book-cover.webp', import.meta.url), Buffer.from(image, 'base64'))
} finally { await browser.close() }
