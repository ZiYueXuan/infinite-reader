// Render the real bilingual landing component at build time. No browser, accounts or AI.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = path.join(root, 'dist')
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { default: Landing } = await server.ssrLoadModule('/src/ui/Landing.tsx')
  const { setLocale } = await server.ssrLoadModule('/src/i18n/runtime.ts')
  const { landingSeo, seoHead, landingStructuredData, PUBLIC_PATHS, publicUrl, SITE_ORIGIN } = await server.ssrLoadModule('/../shared/seo.ts')
  const manifest = JSON.parse(await fs.readFile(path.join(dist, '.vite/manifest.json'), 'utf8'))
  const css = new Set(), seen = new Set()
  function visit(key) {
    if (seen.has(key)) return
    seen.add(key)
    const entry = manifest[key]
    if (!entry) throw new Error('Missing manifest entry: ' + key)
    for (const file of entry.css ?? []) css.add(file)
    for (const imported of entry.imports ?? []) visit(imported)
  }
  visit('src/ui/Landing.tsx')
  let shell = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
  // index.html is the private reader shell; public pages receive their own metadata.
  shell = shell.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta\s+(?:name="(?:description|robots|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/g, '')
  await fs.mkdir(path.join(dist, '_landing'), { recursive: true })
  for (const locale of ['en', 'zh-CN']) {
    setLocale(locale)
    let markup = renderToStaticMarkup(createElement(Landing))
    // SSR imports use source asset paths; resolve them to the production hashes.
    for (const [source, entry] of Object.entries(manifest)) {
      if (entry.file && !entry.file.endsWith('.js')) markup = markup.replaceAll('/' + source, '/' + entry.file)
    }
    if (/\/(?:src|@fs)\//.test(markup)) throw new Error('Unresolved source asset in prerendered landing page')
    const copy = landingSeo[locale]
    const html = shell.replace('<html lang="en">', `<html lang="${locale}">`)
      .replace('</head>', `${seoHead('/', locale, copy.title, copy.description)}\n<script id="landing-structured-data" type="application/ld+json">${landingStructuredData(locale)}</script>\n${[...css].map(file => `<link rel="stylesheet" href="/${file}">`).join('\n')}\n</head>`)
      .replace('<div id="root"></div>', `<div id="root">${markup}</div>`)
    await fs.writeFile(path.join(dist, '_landing', `${locale}.html`), html)
  }
  const urls = PUBLIC_PATHS.flatMap(p => ['en', 'zh-CN'].map(locale => `<url><loc>${publicUrl(p, locale)}</loc>${['en', 'zh-CN'].map(lang => `<xhtml:link rel="alternate" hreflang="${lang}" href="${publicUrl(p, lang)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}${p}"/></url>`))
  await fs.writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('\n')}</urlset>\n`)
  await fs.writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /_landing/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)
  console.log('Prerendered English/Chinese landing pages and generated sitemap.xml / robots.txt')
} finally { await server.close() }
