// Fixture account only: every API intercepted, no real recognition or account writes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const zip = new JSZip(), id = 'atlas-dock-fixture'
const image = n => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#ded1ab"/><path d="M40 90L180 50 350 160 280 340 90 300Z" fill="#a5b491"/><text x="70" y="210" font-size="22">Map ${n}</text></svg>`
const maps = [1, 2].map(n => ({ id: `map-${n}`, title: `地图 ${n} · 波斯及周边地区`, period: '1736—1747', number: String(n), bounds: [[43, 27], [64, 42]], center: [53, 34],
  image: { sha256: createHash('sha256').update(image(n)).digest('hex'), bytes: Buffer.byteLength(image(n)) },
  places: [{ id: 'tabriz', name: '大不里士', modernName: 'Tabriz', coordinates: [46.29, 38.08], imagePoint: [.4, .4] }], recognition: { model: 'fixture', unresolved: [] } }))
zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
zip.file('book.opf', '<package><metadata><title>地图伴读测试</title><language>zh</language></metadata><manifest><item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="a" href="map1.svg" media-type="image/svg+xml"/><item id="b" href="map2.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="ch"/></spine></package>')
zip.file('chapter.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>波斯及周边地区</h1><p>阅读中随时回到地图，沿着地点理解书中的故事。</p><img src="map1.svg"/>${'<p>在山川与城市之间，继续阅读书中的故事。</p>'.repeat(35)}<img src="map2.svg"/></body></html>`)
for (let n = 1; n <= 2; n++) zip.file(`map${n}.svg`, image(n))
const epub = await zip.generateAsync({ type: 'nodebuffer' })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 950 } })
try {
  const page = await browser.newPage(), errors = []
  page.setDefaultTimeout(90000); page.on('pageerror', e => { errors.push(e.message); console.error('Browser error:', e.message) })
  let saved = false, recognitionRequests = 0, textRequests = 0, listRequests = 0, atlasLoads = 0
  const textResults = []
  let failDeleteOnce = false, deleteRequests = 0
  const excludedPlaceIds = []
  let textLimitOnce = null, nextTextResponse = null, delayedResponses = 0
  await page.setRequestInterception(true)
  page.on('request', req => {
    const url = new URL(req.url()), path = url.pathname
    const json = body => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (/\/assets\/AtlasMap-.*\.js$/.test(path) || path === '/src/ui/AtlasMap.tsx') atlasLoads++
    if (path.startsWith('/api/')) {
      if (path === '/api/auth/me') return void json({ user: { id: 'fixture-user', email: 'fixture@example.test', name: 'Reader', avatar_url: null } })
      if (path === '/api/books') return void json({ books: [{ id, title: '地图伴读测试', author: '', language: 'zh', filename: 'fixture.epub', sizeBytes: epub.length, hasCover: false, status: 'ready', chapterCount: 1, chunkCount: 0, indexedChunks: 0, progress: null, createdAt: Date.now() }] })
      if (path.endsWith('/file')) return void req.respond({ status: 200, contentType: 'application/epub+zip', body: epub })
      if (path.endsWith('/annotations')) return void json({ annotations: [] })
      if (path.endsWith('/notes')) return void json({ notes: [] })
      if (path.includes('/text-atlas/places/') && req.method() === 'DELETE') {
        deleteRequests++
        assert.equal(JSON.parse(req.postData()).confirmed, true)
        if (failDeleteOnce) { failDeleteOnce = false; return void req.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'fixture failure' } }) }) }
        const deletedPlaceId = decodeURIComponent(path.split('/').pop())
        if (!excludedPlaceIds.includes(deletedPlaceId)) excludedPlaceIds.push(deletedPlaceId)
        return void json({ deletedPlaceId })
      }
      if (path.endsWith('/atlas')) {
        if (req.method() === 'GET') {
          listRequests++
          // Separate pages exercise mixed image/text caches and client pagination.
          return void json({ maps: !url.search && saved ? maps.map(map => ({ map, recognizedAt: Date.now() })) : [],
            textMaps: url.search ? textResults.slice(1) : textResults.slice(0, 1), excludedPlaceIds,
            cursor: !url.search && textResults.length > 1 ? 'second-page' : null })
        }
        recognitionRequests++; saved = true
        return void json({ status: 'recognized', map: maps[0], recognizedAt: Date.now(), message: '', model: 'fixture', cached: false })
      }
      if (path.endsWith('/text-atlas')) {
        assert.equal(JSON.parse(req.postData()).confirmed, true)
        if (textLimitOnce) {
          const error = textLimitOnce; textLimitOnce = null
          return void req.respond({ status: 429, contentType: 'application/json', body: JSON.stringify({ error }) })
        }
        if (nextTextResponse) {
          const response = nextTextResponse; nextTextResponse = null
          return void setTimeout(() => { delayedResponses++; json(response) }, 1200)
        }
        textRequests++
        const place = (id, name, coordinates) => ({ id, name, modernName: name, coordinates, imagePoint: null,
          source: 'GeoNames', sourceUrl: 'https://www.geonames.org/112931', featureCode: 'PPLC', countryCode: 'IR' })
        const result = { status: 'ready', cached: false, createdAt: textRequests, unresolved: textRequests === 1 ? ['未定位示例'] : [], map: {
          id: 'text-' + Math.min(textRequests, 2), title: '文字地点', period: '', number: '', bounds: [[45, 32], [54, 40]], center: [50, 36],
          places: [place('geonames:112931', '德黑兰', [51.42, 35.69]), ...(textRequests > 1 ? [place('geonames:113646', '大不里士', [46.29, 38.08])] : [])] } }
        if (textRequests === 3) result.map.places = [place('geonames:1790956', '五台山', [113.56261, 39.08262])]
        const previous = textResults.findIndex(r => r.map.id === result.map.id)
        if (previous >= 0) textResults.splice(previous, 1, result)
        else textResults.push(result)
        // A late completion after closing must still update the dock.
        return void setTimeout(() => json(result), textRequests === 2 ? 1200 : 0)
      }
      return void json({ ok: true })
    }
    // Camera/UI regression must not wait for live terrain or hydrology providers.
    if (['s3.amazonaws.com', 'tiles.openfreemap.org', 'static.cloudflareinsights.com'].includes(url.hostname)) return void req.abort()
    void req.continue()
  })
  const ready = () => page.waitForFunction(() => window.__reader?.hasBook && !window.__store.getState().loading).catch(async error => {
    await page.screenshot({ path: '/tmp/atlas-dock-ready-failure.png' })
    console.error('Reader readiness failed:', await page.evaluate(() => document.body.innerText))
    throw error
  })
  await page.goto(`${process.env.READER_URL || 'http://127.0.0.1:5176'}/book/${id}?lang=zh-CN`, { waitUntil: 'domcontentloaded' }); await ready()
  assert.equal(await page.$('.atlas-dock-trigger'), null)
  assert.equal(atlasLoads, 0, 'no globe chunk before opening')
  await page.evaluate(() => window.__reader.hooks.onImageClick('map1.svg', null))
  await page.click('.image-preview-map')
  await page.waitForSelector('.book-atlas .atlas-map-controls button:not(:disabled)')
  await page.click('.atlas-close'); await page.waitForSelector('.atlas-dock-trigger')
  await page.click('[data-image-atlas]')
  assert.equal((await page.$$('.atlas-dock-map-item')).length, 1)
  assert.equal(await page.$eval('[data-text-atlas]', el => el.disabled), true, 'image-only book disables text shortcut')
  await page.click('.atlas-dock-map-item')
  await page.waitForSelector('.atlas-dock-mini .atlas-map-controls button:not(:disabled)')
  const size = await page.$eval('.atlas-dock-mini', el => { const r = el.getBoundingClientRect(); return r.width * r.height / (innerWidth * innerHeight) })
  assert.ok(Math.abs(size - 1 / 6) < .01, `mini area ${size}`)
  const state = () => page.evaluate(() => ({ zoom: window.__store.getState().zoom, turned: window.__store.getState().turned }))
  const before = await state()
  await page.focus('.atlas-dock-mini canvas')
  await page.keyboard.down('Control'); await page.keyboard.press('+'); await page.keyboard.up('Control')
  assert.deepEqual(await state(), before, 'map zoom shortcut leaves book unchanged')
  const settledMarker = async () => {
    await page.waitForFunction(() => {
      const marker = document.querySelector('.atlas-dock-mini .atlas-marker')
      if (!marker) return false
      const transform = marker.style.transform
      if (marker.dataset.lastTransform !== transform) {
        marker.dataset.lastTransform = transform; marker.dataset.stableSince = String(performance.now())
        return false
      }
      return performance.now() - Number(marker.dataset.stableSince) > 650
    })
    return page.$eval('.atlas-dock-mini .atlas-marker', el => el.style.transform)
  }
  const mapPosition = await settledMarker()
  for (const focus of ['.atlas-dock-mini canvas', '.atlas-dock-mini [aria-label="返回地图列表"]']) {
    await page.focus(focus)
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(leaf => window.__store.getState().turned === leaf, {}, before.turned + 1)
    assert.equal(await settledMarker(), mapPosition, 'right arrow turns the book without panning the miniature')
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(leaf => window.__store.getState().turned === leaf, {}, before.turned)
    assert.equal(await settledMarker(), mapPosition, 'left arrow turns the book without panning the miniature')
  }
  console.log('PASS initial mini, keyboard, camera')
  await page.screenshot({ path: '/tmp/atlas-dock-desktop.png' })
  const dockBounds = () => page.$eval('.atlas-dock-panel', el => { const r = el.getBoundingClientRect(); return { left: r.left, bottom: r.bottom, width: r.width, height: r.height } })
  const smallBounds = await dockBounds()
  await page.$eval('.atlas-dock-mini canvas', el => { el.dataset.sameMap = 'yes' })
  await page.click('[aria-label="放大地图"]'); await page.waitForSelector('.atlas-dock-expanded')
  const largeBounds = await dockBounds()
  assert.equal(await page.$('dialog[open]'), null, 'expand is non-modal')
  assert.equal(largeBounds.left, smallBounds.left); assert.equal(largeBounds.bottom, smallBounds.bottom)
  assert.ok(largeBounds.width > smallBounds.width && largeBounds.height > smallBounds.height)
  assert.equal(await page.$eval('.atlas-dock-mini canvas', el => el.dataset.sameMap), 'yes', 'resize preserves WebGL/camera')
  await page.click('[aria-label="缩小地图"]')
  assert.deepEqual(await dockBounds(), smallBounds)
  assert.equal(await page.$eval('.atlas-dock-mini canvas', el => el.dataset.sameMap), 'yes')
  assert.equal(recognitionRequests, 1)
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await page.waitForSelector('.atlas-dock-trigger')
  const loadedBeforeList = atlasLoads
  await page.click('[data-image-atlas]')
  assert.equal((await page.$$('.atlas-dock-map-item')).length, 2)
  assert.equal(atlasLoads, loadedBeforeList, 'list does not load WebGL')
  await page.screenshot({ path: '/tmp/atlas-dock-list.png' })
  const target = await page.evaluate(() => {
    const r = window.__reader, ch = window.__store.getState().current.parsed.chapters[0]
    const page = r.pagination.pageForOffset(0, ch.blocks.find(b => b.img?.path === 'map2.svg').start)
    return { leaf: r.pageToLeafTurned(page), path: r.pagination.pages[page].images[0]?.path }
  })
  assert.equal(target.path, 'map2.svg')
  await page.click('.atlas-dock-panel li:last-child .atlas-dock-anchor')
  await page.waitForFunction(leaf => window.__store.getState().turned === leaf, {}, target.leaf)
  await page.setViewport({ width: 390, height: 844 }); await ready()
  await page.click('[data-image-atlas]'); await page.click('.atlas-dock-map-item')
  await page.waitForSelector('.atlas-dock-mini .atlas-map-controls button:not(:disabled)')
  assert.ok(await page.$eval('.atlas-dock-panel', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }))
  assert.ok(await page.$eval('.atlas-dock-panel', el => {
    const panel = el.getBoundingClientRect(), agent = document.querySelector('.reading-agent > button')?.getBoundingClientRect()
    return !agent || panel.bottom <= agent.top || panel.right <= agent.left
  }), 'miniature must not overlap the agent launcher')
  await page.screenshot({ path: '/tmp/atlas-dock-mobile.png' })
  await page.keyboard.press('Escape'); assert.equal(await page.$('.atlas-dock-panel'), null)
  const openText = async text => {
    await page.evaluate(text => window.__store.getState().setPopover({ kind: 'selection', text,
      locator: { chapter: 0, start: 0, end: text.length }, rect: { left: 160, top: 250, width: 80, height: 30 } }), text)
    await page.waitForSelector('[aria-label="生成阅读地图"]', { visible: true })
    await page.click('[aria-label="生成阅读地图"]').catch(async e => { await page.screenshot({ path: '/tmp/atlas-dock-text-failure.png' }); throw e })
    await page.waitForSelector('.text-atlas[open] .text-atlas-primary')
  }
  const expectFocusedPlace = async name => {
    await page.waitForSelector('.atlas-dock-mini .atlas-map-controls button:not(:disabled)').catch(async error => {
      console.error('Focus readiness failed:', name, await page.$eval('.atlas-dock', el => el.innerText))
      await page.screenshot({ path: '/tmp/atlas-focus-readiness-failure.png' })
      throw error
    })
    await page.waitForFunction(name => {
      const marker = document.querySelector('.atlas-dock .atlas-marker.selected')
      const canvas = document.querySelector('.atlas-dock .atlas-map-canvas')
      if (!marker || !canvas || marker.querySelector('span')?.textContent !== name) return false
      const pin = marker.getBoundingClientRect(), map = canvas.getBoundingClientRect()
      const scale = document.querySelector('.atlas-dock .maplibregl-ctrl-scale')?.textContent ?? ''
      const distance = Number.parseFloat(scale.replace(/\s/g, ''))
      return Math.abs(pin.x + pin.width / 2 - map.x - map.width / 2) < 2
        && Math.abs(pin.y + pin.height / 2 - map.y - map.height / 2) < 2
        && distance > 0 && (/km/.test(scale) ? distance <= 50 : /m/.test(scale) && distance <= 50000)
    }, {}, name)
  }
  const reviewAndView = async names => {
    await page.waitForSelector('.text-atlas-review')
    assert.deepEqual(await page.$$eval('.text-atlas-review-list strong', els => els.map(el => el.textContent)), names)
    assert.equal(await page.$('.text-atlas canvas'), null, 'review is a place explanation, not a second map')
    assert.ok(await page.$eval('.text-atlas', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }))
    const calls = textRequests
    await page.click('.text-atlas-view-map')
    await page.waitForSelector('.text-atlas[open]', { hidden: true })
    assert.equal(textRequests, calls, 'viewing reviewed results never calls inference')
  }
  console.log('PASS inline resize, image restore, mobile bounds')
  await openText('德黑兰')
  assert.equal(textRequests, 0, 'opening is not consent')
  await page.click('.text-atlas .atlas-close')
  assert.equal(textRequests, 0, 'cancel sends no paid request')
  for (const daily of [true, false]) {
    await openText('德黑兰')
    textLimitOnce = { code: daily ? 'text_atlas_daily_limit' : 'text_atlas_minute_limit',
      message: daily ? '今日地点识别已达 120 次上限。已有地图仍可查看。' : '地点识别每分钟最多 6 次，请等待后重试。', retryAfter: daily ? 3600 : 2 }
    await page.click('.text-atlas-primary')
    await page.waitForSelector('.text-atlas [role="alert"]')
    assert.match(await page.$eval('.text-atlas-consent', el => el.textContent), /可重试时间.*本地|可重试时间（设备当地时间）/)
    assert.match(await page.$eval('.text-atlas-consent small', el => el.textContent), /未开始 AI 识别，不消耗 token/)
    assert.equal(await page.$eval('.text-atlas-actions button:last-child', el => el.disabled), true)
    assert.equal(textRequests, 0)
    if (daily) await page.screenshot({ path: '/tmp/atlas-daily-limit-mobile.png' })
    else {
      await page.waitForFunction(() => !document.querySelector('.text-atlas-actions button:last-child')?.disabled)
      assert.equal(textRequests, 0, 'cooldown never automatically starts a paid retry')
      await page.click('.text-atlas-actions button:last-child')
      await page.waitForSelector('.text-atlas-primary')
      assert.equal(textRequests, 0, 'retry still requires confirmation')
    }
    await page.click('.text-atlas .atlas-close')
  }
  await openText('德黑兰')
  await page.click('.text-atlas-primary')
  await page.waitForSelector('.text-atlas-review')
  assert.equal(await page.$('.atlas-dock-panel'), null, 'closed map stays closed during result review')
  assert.match(await page.$eval('.text-atlas-unresolved', el => el.textContent), /未定位示例/)
  await page.screenshot({ path: '/tmp/atlas-result-review-mobile.png' })
  await reviewAndView(['德黑兰'])
  await page.waitForSelector('.atlas-dock-expanded .text-atlas-source')
  assert.equal(await page.$('dialog[open]'), null, 'closed dock opens expanded instead of a result modal')
  assert.match(await page.$eval('.atlas-dock-mini footer', el => el.textContent), /1 个地点/)
  await expectFocusedPlace('德黑兰')
  await page.click('[data-image-atlas]')
  assert.equal((await page.$$('.atlas-dock-map-item')).length, 2, 'image list contains only image maps')
  await page.click('[data-text-atlas]')
  await page.waitForSelector('.atlas-dock-mini .atlas-map-controls button:not(:disabled)')
  assert.ok(await page.$eval('.atlas-dock-panel', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }))
  await page.click('[aria-label="放大地图"]')
  await page.waitForSelector('.atlas-dock-expanded .text-atlas-source')
  assert.ok(await page.$eval('.atlas-dock-expanded', el => {
    const panel = el.getBoundingClientRect(), source = el.querySelector('.text-atlas-source').getBoundingClientRect()
    return panel.top >= 48 && source.left < panel.left + 32
  }), 'narrow expansion clears top controls and uses the full place-list width')
  assert.equal(await page.$('dialog[open]'), null, 'saved expansion is inline')
  assert.equal(await page.$('.text-atlas-primary'), null, 'saved expansion skips paid confirmation')
  assert.equal(textRequests, 1)
  await openText('德黑兰与大不里士')
  assert.equal(textRequests, 1, 'open dock still requires generation confirmation')
  await page.click('.text-atlas-primary')
  await page.waitForSelector('.text-atlas-review')
  assert.match(await page.$eval('.atlas-dock-mini footer', el => el.textContent), /1 个地点/, 'open map stays unchanged before view action')
  await reviewAndView(['德黑兰', '大不里士'])
  await page.waitForFunction(() => document.querySelector('.atlas-dock-mini footer')?.textContent.includes('2 个地点'))
  assert.equal((await page.$$('.atlas-dock-mini .atlas-marker')).length, 2, 'new pins refresh in the existing dock')
  assert.ok(await page.$('.atlas-dock-expanded'), 'recognition preserves expanded state')
  assert.equal(await page.$('dialog[open]'), null)
  await expectFocusedPlace('大不里士')
  // An old first result must not win over a newly added second place.
  assert.equal((await page.$$('.atlas-dock-mini .atlas-marker')).length, 2)
  console.log('PASS inline recognized pins')
  await page.setViewport({ width: 1440, height: 950 }); await ready()
  await page.screenshot({ path: '/tmp/atlas-dock-capsule-desktop.png' })
  await page.setViewport({ width: 390, height: 844 }); await ready()
  await page.screenshot({ path: '/tmp/atlas-dock-inline-result.png' })
  await page.click('.atlas-dock .atlas-map-controls button:nth-child(2)')
  nextTextResponse = { ...textResults[0], cached: true }
  await openText('德黑兰（重新定位缓存地点）')
  await page.click('.text-atlas-primary')
  await reviewAndView(['德黑兰'])
  await expectFocusedPlace('德黑兰')
  assert.equal(textRequests, 2, 'cached refocus never adds inference')
  nextTextResponse = { ...textResults[0], cached: true }
  const delayedBeforeCancel = delayedResponses
  await openText('德黑兰（已有缓存）')
  await page.click('.text-atlas-primary')
  await page.click('.text-atlas .atlas-close')
  await page.waitForFunction(() => !document.querySelector('.text-atlas[open]'))
  while (delayedResponses === delayedBeforeCancel) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(await page.$('dialog[open]'), null, 'late cached response never reopens the dialog')
  assert.equal(textRequests, 2, 'cached replay does not add inference')
  nextTextResponse = { status: 'uncertain', map: null, unresolved: ['虚构地点'], createdAt: 4, cached: true }
  await openText('虚构地点')
  await page.click('.text-atlas-primary')
  await page.waitForFunction(() => document.querySelector('.text-atlas-consent')?.textContent.includes('暂未可靠定位'))
  assert.match(await page.$eval('.atlas-dock-mini footer', el => el.textContent), /2 个地点/, 'unresolved result preserves the open map')
  await page.click('.text-atlas .atlas-close')
  await page.click('[aria-label="收起地图"]')
  await openText('德黑兰与大不里士')
  await page.click('.text-atlas-primary')
  await reviewAndView(['五台山'])
  await page.waitForSelector('.atlas-dock-expanded .text-atlas-source')
  assert.equal(await page.$('dialog[open]'), null, 'closed dock reopens expanded with accumulated places')
  await page.waitForFunction(() => document.querySelectorAll('.text-atlas-source').length === 2)
  await expectFocusedPlace('五台山')
  assert.equal(textRequests, 3)
  const labels = await page.$$eval('.atlas-dock .atlas-places button', els => els.map(el => el.textContent))
  assert.ok(labels.some(x => x.includes('五台山')))
  assert.ok(labels.every(x => !x.includes('大不里士')), 'corrected passage replaces its outdated point in the current dock')
  await page.click('[aria-label="收起地图"]')
  console.log('PASS closed-dock expanded presentation, accumulated and corrected places')
  saved = false
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')
  await page.setViewport({ width: 430, height: 932, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready()
  await page.waitForSelector('.app[data-phone-reading]')
  await page.waitForSelector('.atlas-dock-trigger')
  assert.equal(await page.$eval('.atlas-dock', el => getComputedStyle(el).display), 'none', 'immersive reading stays uncluttered')
  await page.click('.phone-folio')
  await page.waitForSelector('.atlas-dock-trigger', { visible: true })
  assert.equal(await page.$eval('[data-image-atlas]', el => el.disabled), true)
  await page.click('[data-text-atlas]')
  assert.equal(await page.$('.atlas-dock-map-item'), null, 'text launcher skips the intermediate list')
  assert.match(await page.$eval('.atlas-dock-mini footer', el => el.textContent), /2 个地点/)
  await page.waitForSelector('.atlas-dock-mini .atlas-map-controls button:not(:disabled)')
  assert.ok(await page.$eval('.atlas-dock-panel', el => {
    const panel = el.getBoundingClientRect(), toolbar = document.querySelector('.phone-bottom').getBoundingClientRect()
    return panel.top >= 0 && panel.bottom <= toolbar.top && panel.right <= innerWidth
  }), 'phone map stays above reading controls')
  await page.click('[aria-label="放大地图"]')
  await page.waitForFunction(() => document.querySelectorAll('.text-atlas-source').length === 2)
  assert.equal(textRequests, 3, 'reload, mini and full views never regenerate')
  await page.screenshot({ path: '/tmp/atlas-dock-text-mobile.png' })
  // Removal is explicit, book-wide, durable, and independent of paid recognition.
  await page.click('[aria-label="删除地点“五台山”"]')
  await page.waitForSelector('.text-atlas-delete-confirm[open]')
  assert.equal(deleteRequests, 0)
  assert.match(await page.$eval('.text-atlas-delete-confirm', el => el.textContent), /本书所有文字地图/)
  assert.ok(await page.$eval('.text-atlas-delete-confirm', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }))
  await page.screenshot({ path: '/tmp/atlas-delete-confirm-mobile.png' })
  await page.keyboard.press('Escape')
  await page.waitForSelector('.text-atlas-delete-confirm', { hidden: true })
  assert.equal(deleteRequests, 0, 'cancel never deletes')
  await page.click('[aria-label="删除地点“五台山”"]')
  failDeleteOnce = true
  await page.click('.text-atlas-danger')
  await page.waitForSelector('.text-atlas-delete-confirm [role="alert"]')
  assert.equal((await page.$$('.text-atlas-source')).length, 2, 'failure keeps the place')
  await page.click('.text-atlas-danger')
  await page.waitForSelector('.text-atlas-delete-confirm', { hidden: true })
  await page.waitForFunction(() => document.querySelectorAll('.text-atlas-source').length === 1)
  assert.equal(deleteRequests, 2)
  assert.equal(textRequests, 3, 'deleting never calls AI')
  await page.click('[aria-label="收起地图"]')
  await page.click('[data-text-atlas]')
  assert.match(await page.$eval('.atlas-dock-mini footer', el => el.textContent), /1 个地点/)
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready()
  await page.waitForSelector('.atlas-dock-trigger')
  if (!await page.$eval('.atlas-dock-trigger', el => !!el.getClientRects().length)) await page.click('.phone-folio')
  await page.click('[data-text-atlas]')
  await page.click('[aria-label="放大地图"]')
  await page.waitForFunction(() => document.querySelectorAll('.text-atlas-source').length === 1)
  assert.equal(await page.$('[aria-label="删除地点“五台山”"]'), null, 'removed place stays removed after reload')
  await page.click('.text-atlas-delete')
  await page.click('.text-atlas-danger')
  await page.waitForSelector('.text-atlas-delete-confirm', { hidden: true })
  await page.waitForSelector('.atlas-dock-trigger', { hidden: true })
  assert.equal(await page.$('.atlas-dock .atlas-marker'), null)
  assert.equal(textRequests, 3)
  assert.deepEqual(excludedPlaceIds.sort(), ['geonames:112931', 'geonames:1790956'])
  const firstVisibleResult = { ...textResults[0], cached: true, map: { ...textResults[0].map,
    id: 'first-visible-result', places: [
      { ...textResults[0].map.places[0], id: 'first-visible-place' },
      { ...textResults[0].map.places[0], id: 'second-visible-place', name: '第二个新地点', coordinates: [120, 30] },
    ] } }
  nextTextResponse = firstVisibleResult
  const delayedBeforeDismissal = delayedResponses
  await openText('德黑兰（取消等待）')
  await page.click('.text-atlas-primary')
  await page.click('.text-atlas .atlas-close')
  while (delayedResponses === delayedBeforeDismissal) await new Promise(resolve => setTimeout(resolve, 50))
  await page.waitForSelector('.atlas-dock-trigger')
  assert.equal(await page.$('.atlas-dock-panel'), null, 'dismissed completion caches without opening a closed dock')
  assert.equal(await page.$('dialog[open]'), null)
  // Clear the just-cached result by reloading: this fixture response was not persisted.
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready()
  assert.equal(await page.$('.atlas-dock-trigger'), null)
  nextTextResponse = firstVisibleResult
  await openText('德黑兰（首个可见地点）')
  await page.click('.text-atlas-primary')
  await reviewAndView(['德黑兰', '第二个新地点'])
  await page.waitForSelector('.atlas-dock-expanded .text-atlas-source')
  assert.equal(await page.$('dialog[open]'), null, 'first place opens an expanded dock even without an existing launcher')
  await expectFocusedPlace('德黑兰')
  assert.equal((await page.$$('.atlas-dock .atlas-marker')).length, 2, 'multiple new pins stay on map while the first becomes the center')
  await page.waitForSelector('.atlas-dock-mini .atlas-map-controls button:not(:disabled)')
  await page.screenshot({ path: '/tmp/atlas-dock-first-result-expanded.png' })
  await page.click('[aria-label="缩小地图"]')
  assert.equal(await page.$('.atlas-dock-expanded'), null)
  assert.ok(await page.$('.atlas-dock-mini'))
  assert.equal(textRequests, 3, 'cached result and resizing add no inference')
  console.log('PASS first visible place opens expanded; dismissed completion stays closed')

  const lastPlace = '测试地点 16'
  const pin = `.atlas-dock-expanded .atlas-marker[aria-label="定位${lastPlace}"]`
  const entry = '[data-text-place-id="fixture:place-16"]'
  textResults.splice(0, textResults.length, { ...firstVisibleResult, map: { ...firstVisibleResult.map,
    places: Array.from({ length: 16 }, (_, index) => ({
      ...firstVisibleResult.map.places[0], id: `fixture:place-${index + 1}`, name: `测试地点 ${index + 1}`,
      coordinates: [51 + (index % 4) * .3, 35 + Math.floor(index / 4) * .3],
    })),
  } })
  for (const isMobile of [true, false]) {
    if (!isMobile) await page.setUserAgent(await browser.userAgent())
    await page.setViewport({ width: isMobile ? 430 : 1440, height: 932, isMobile, hasTouch: isMobile })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: isMobile ? 'reduce' : 'no-preference' }])
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready()
    await page.waitForSelector('[data-text-atlas]')
    if (isMobile) await page.click('.phone-folio')
    await page.click('[data-text-atlas]')
    await page.click('[aria-label="放大地图"]')
    await page.waitForSelector('.atlas-dock-expanded .atlas-map-controls button:not(:disabled)')
    await page.click('.atlas-dock-expanded .atlas-map-controls button:first-child')
    await settledMarker()
    const bounds = await dockBounds()
    assert.ok(await page.$eval(entry, row => row.getBoundingClientRect().top >= row.closest('aside').getBoundingClientRect().bottom),
      'the last place starts offscreen in the sidebar')
    await page.click(pin)
    await page.waitForFunction(selector => {
      const row = document.querySelector(selector)
      const sidebar = row.closest('aside').getBoundingClientRect()
      const rect = row.getBoundingClientRect()
      return row.querySelector('button[aria-pressed="true"]') && rect.top >= sidebar.top && rect.bottom <= sidebar.bottom
        && getComputedStyle(row).backgroundColor !== getComputedStyle(row.parentElement.firstElementChild).backgroundColor
    }, {}, entry)
    await expectFocusedPlace(lastPlace)
    assert.deepEqual(await dockBounds(), bounds, 'revealing a place does not move the dock')
    assert.equal(await page.$eval('.atlas-dock-expanded aside', sidebar => sidebar.contains(document.activeElement)), false,
      'map selection does not move keyboard focus into the list')
    assert.equal(textRequests, 3, 'pin selection never uses recognition')
    await page.screenshot({ path: `/tmp/atlas-pin-selection-${isMobile ? 'mobile' : 'desktop'}.png` })
  }
  console.log('PASS pin selection reveals and highlights an offscreen place on desktop and mobile')
  await page.evaluate(() => window.__store.getState().returnToShelf())
  await page.waitForFunction(() => !document.querySelector('.atlas-dock-trigger'))
  assert.equal(recognitionRequests, 1); assert.ok(listRequests >= 2); assert.deepEqual(errors, [])
  console.log('PASS empty state, live recognition, restore, anchors, miniature size, expansion, left/right book navigation without map movement, mobile bounds, text consent/cancel, single union map, ID deduplication, late completion, paginated text-only restoration, cached expansion, cleanup; same-passage correction, closed and empty dock expansion; confirmed deletion, cancel, retry, reload persistence and last-place empty state; one image and three text requests')
} catch (error) {
  const pages = await browser.pages()
  const page = pages.at(-1)
  if (page) {
    console.error('Failed UI state:', await page.evaluate(() => document.body.innerText))
    await page.screenshot({ path: '/tmp/atlas-dock-regression-failure.png' })
  }
  throw error
} finally { await browser.close() }
