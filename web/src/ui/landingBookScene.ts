import * as THREE from 'three'
import { BookModel } from '../engine/book'
import { markBand } from '../book/pageRender'
import { READER_FOV, updateReaderCamera } from '../engine/readerCamera'
import { bookOpening, bookView, chapterWeight, smooth as ease, storyFrame } from './landingStory'

export type BookScene = { update: (progress: number) => void; resize: () => void; dispose: () => void }
// Canvas text needs its own glyph load: document.fonts.ready only covers text already in the DOM.
export async function loadBookFonts(zh: boolean) {
  await Promise.all([
    document.fonts.load('74px "EB Garamond Variable"', 'Infinite Reader A world within.'),
    ...(zh ? [document.fonts.load('38px "Noto Serif SC Variable"', '阅读，让世界变得辽阔。慢下来，读进一个世界。在字里行间，遇见自己的想法。一本书，是一次向内的旅行。让目光停留，让思绪自由生长。读到共鸣之处，留下轻轻的一笔。一个问题，一段注释，都是你与文字之间的对话。当零散的想法开始相连，新的理解，也就慢慢浮现。')] : []),
  ])
}

/** The actual reader book and camera, driven by scroll without account state or EPUB loading. */
export function createBookScene(host: HTMLElement, zh: boolean, coverImage: HTMLImageElement): BookScene {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = .95
  host.appendChild(renderer.domElement)
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(READER_FOV, 1, 1, 200)
  const atlasScene = new THREE.Scene(), atlasCamera = new THREE.OrthographicCamera(-5, 5, 3.5, -3.5, .1, 60)
  atlasCamera.position.set(0, 0, 12)
  renderer.autoClear = false
  const book = new THREE.Group(); scene.add(book)
  scene.add(new THREE.AmbientLight('#fff5e9', 1))
  const key = new THREE.DirectionalLight('#fff1d5', 1.7); key.position.set(-3, 6, 8); scene.add(key)
  const fill = new THREE.DirectionalLight('#dbe9f4', .5); fill.position.set(5, -2, 4); scene.add(fill)
  atlasScene.add(new THREE.AmbientLight('#fff5e9', 1), key.clone(), fill.clone())
  const textures: THREE.Texture[] = [], geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = []
  const own = <T extends THREE.BufferGeometry>(g: T) => { geometries.push(g); return g }
  const mat = <T extends THREE.Material>(m: T) => { materials.push(m); return m }
  const pageTexture = (side = 0) => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1536
    const c = canvas.getContext('2d')!
    c.fillStyle = '#f4efdf'; c.fillRect(0, 0, 1024, 1536)
    // Fine, deterministic paper grain, generated once rather than per frame.
    let seed = 271828
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
    for (let i = 0; i < 19000; i++) {
      const x = random() * 1024, y = random() * 1536
      c.fillStyle = 'rgba(86,70,43,.025)'; c.fillRect(x, y, 1, 2)
    }
    const serif = zh ? '"Noto Serif SC Variable", serif' : '"EB Garamond Variable", serif'
    c.fillStyle = '#858577'; c.font = `22px ${serif}`; c.fillText(zh ? '阅读，让世界变得辽阔。' : 'THE ART OF PAYING ATTENTION', 100, 116)
    c.fillStyle = '#172c22'; c.font = `${zh ? 64 : 74}px ${serif}`
    const heading = zh ? (side ? ['在字里行间，', '遇见自己的想法。'] : ['慢下来，', '读进一个世界。']) : (side ? ['Between', 'the lines.'] : ['A little space.', 'A wider world.'])
    heading.forEach((line, i) => c.fillText(line, 100, 305 + i * 92))
    const fontSize = zh ? 38 : 40, bodyX = 100, bodyY = 570, lineHeight = 78
    c.fillStyle = '#344137'; c.font = `${fontSize}px ${serif}`
    const lines = zh ? ['一本书，是一次向内的旅行。', '让目光停留，让思绪自由生长。', '', '读到共鸣之处，留下轻轻的一笔。', '一个问题，一段注释，', '都是你与文字之间的对话。', '', '当零散的想法开始相连，', '新的理解，也就慢慢浮现。'] : ['A book is an invitation to slow down.', 'To notice what might otherwise pass by.', '', 'Some words stay with us.', 'We underline them. We return to them.', 'We leave a thought beside the page.', '', 'And somewhere between the lines,', 'a new way of seeing begins.']
    lines.forEach((line, i) => c.fillText(line, bodyX, bodyY + i * lineHeight))
    // Mark the first body sentence, above the floating demo card. Use the reader's
    // ink-band rule and the exact font/line origin used to paint this page.
    const band = markBand({ y: 0, baseline: bodyY }, fontSize)
    const markedLine = { x: bodyX, width: c.measureText(lines[0]).width, ...band }
    c.strokeStyle = '#c6c4b0'; c.beginPath(); c.moveTo(100, 1320); c.lineTo(924, 1320); c.stroke()
    c.textAlign = 'center'; c.font = `24px ${serif}`; c.fillText(side ? '07' : '06', 512, 1420)
    const shade = c.createLinearGradient(side ? 0 : 1024, 0, side ? 95 : 929, 0); shade.addColorStop(0, '#342d252b'); shade.addColorStop(1, '#342d2500'); c.fillStyle = shade; c.fillRect(0, 0, 1024, 1536)
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); textures.push(tex); return { tex, markedLine }
  }
  // Use the very same decoded artwork as the DOM poster; no second cover design.
  const coverTex = new THREE.Texture(coverImage)
  coverTex.colorSpace = THREE.SRGBColorSpace; coverTex.needsUpdate = true
  coverTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); textures.push(coverTex)
  const leftPage = pageTexture(), rightPage = pageTexture(1)
  const blank = new THREE.DataTexture(new Uint8Array([244, 239, 223, 255]), 1, 1)
  blank.colorSpace = THREE.SRGBColorSpace; blank.needsUpdate = true; textures.push(blank)
  const model = new BookModel({ leafCount: 96, turned: 48, open: false,
    getTexture: page => page % 2 ? leftPage.tex : rightPage.tex,
    cover: { outer: coverTex, outerBump: blank, inner: blank, cloth: new THREE.Color('#294a3d'), glossy: false, accent: '#294a3d' },
  })
  book.add(model.group)
  const modelScale = 2.35 / model.W
  let lastTurnStep = -1, lastRest = -1
  const seekBook = (open: number, turn: number) => {
    model.seekOpening(open)
    if (turn > 0 && turn < 1) {
      const step = Math.floor(turn * 39)
      if (lastTurnStep < 0 || step < lastTurnStep) {
        model.jumpTo(48); model.update(0); model.turn(1, 1, 'quick'); lastTurnStep = 0
      }
      for (; lastTurnStep < step; lastTurnStep++) model.update(1 / 60)
      lastRest = -1
    } else {
      const rest = turn >= 1 ? 49 : 48
      if (lastRest !== rest) { model.jumpTo(rest); lastRest = rest }
      lastTurnStep = -1
    }
    model.update(0)
  }
  const gold = mat(new THREE.MeshStandardMaterial({ color: '#c4af73', roughness: .38, metalness: .65 }))
  const highlightGeo = own(new THREE.PlaneGeometry(1, 1, 24, 1))
  const highlight = new THREE.Mesh(highlightGeo, mat(new THREE.MeshBasicMaterial({ color: '#d4b854', transparent: true, opacity: .34, depthWrite: false })))
  model.group.add(highlight)
  const highlightPoint = new THREE.Vector3()
  const atlas = new THREE.Group(); atlasScene.add(atlas)
  const globeMaterial = mat(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .85, metalness: .05 }))
  const globe = new THREE.Mesh(own(new THREE.SphereGeometry(1.8, 64, 48)), globeMaterial)
  globe.rotation.y = -Math.PI / 2; atlas.add(globe)
  const gridMaterial = mat(new THREE.LineBasicMaterial({ color: '#cbdab5', transparent: true, opacity: .15 }))
  const spherePoint = (lon: number, lat: number, r = 1.805) => new THREE.Vector3(r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.cos(lon))
  for (let lat = -60; lat <= 60; lat += 30) {
    const points = Array.from({ length: 97 }, (_, i) => spherePoint(i / 96 * Math.PI * 2, lat * Math.PI / 180))
    atlas.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(points)), gridMaterial))
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const points = Array.from({ length: 49 }, (_, i) => spherePoint(lon * Math.PI / 180, -Math.PI / 2 + i / 48 * Math.PI))
    atlas.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(points)), gridMaterial))
  }
  for (const [lon, lat] of [[2.35, 48.86], [-.12, 51.5], [12.48, 41.9]]) {
    const pin = new THREE.Mesh(own(new THREE.SphereGeometry(.027, 12, 8)), gold)
    pin.position.copy(spherePoint(lon * Math.PI / 180, lat * Math.PI / 180, 1.835)); atlas.add(pin)
  }
  const orbit = new THREE.Mesh(own(new THREE.TorusGeometry(2.02, .007, 6, 120)), gold); orbit.rotation.set(.3, .6, .15); atlas.add(orbit)
  let progress = 0, atlasRequested = false, disposed = false
  let viewHeight = 6.4
  const resize = () => {
    const { width, height } = host.getBoundingClientRect(); if (!width || !height) return
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(width, height, false)
    const aspect = width / height, mobile = width < 760
    viewHeight = mobile ? 6.0 / aspect : 6.4
    camera.aspect = aspect
    atlasCamera.left = -viewHeight * aspect / 2; atlasCamera.right = -atlasCamera.left; atlasCamera.top = viewHeight / 2; atlasCamera.bottom = -atlasCamera.top; atlasCamera.updateProjectionMatrix()
    update(progress)
  }
  const update = (p: number) => {
    progress = p
    const { time } = storyFrame(p), { open } = bookOpening(time)
    const turn = ease(.68, .96, time), map = chapterWeight(7, time), atlasWeight = chapterWeight(8, time)
    const full = chapterWeight(9, time), mobile = host.clientWidth < 760
    seekBook(open, turn)
    book.position.set(0, -.05 - atlasWeight * 10, 0)
    book.scale.setScalar(modelScale * (1.1 - map * .12 + full * (mobile ? .02 : .12)))
    // Frame the same head-on camera to the right using a lens shift, never a sideways orbit.
    const offset = mobile ? 0 : (1.4 - map * .5) / (viewHeight * camera.aspect) * host.clientWidth
    camera.setViewOffset(host.clientWidth, host.clientHeight, -offset, 0, host.clientWidth, host.clientHeight)
    updateReaderCamera(camera, 0, 0, viewHeight / (2 * Math.tan(READER_FOV * Math.PI / 360)), bookView(time).tilt)
    model.setLightDir(key.position.clone().transformDirection(camera.matrixWorldInverse))
    atlas.visible = atlasWeight > .001
    atlas.position.set(mobile ? 0 : 1.4, -.05, .1)
    atlas.rotation.set(.25, -.3 + (time - 8) * .8, -.08)
    atlas.scale.setScalar(Math.max(.001, atlasWeight))
    if (time > 7.65 && !atlasRequested) {
      atlasRequested = true
      new THREE.TextureLoader().load('/landing/earth.svg', texture => {
        if (disposed) { texture.dispose(); return }
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        textures.push(texture); globeMaterial.map = texture; globeMaterial.needsUpdate = true; update(progress)
      }, undefined, () => { /* Keep the lit globe and coordinate grid if the texture is unavailable. */ })
    }
    const mark = ease(3.05, 3.7, time)
    highlight.visible = mark > .001
    const surface = model.pageSurface(1)
    if (highlight.visible && surface) {
      const positions = highlightGeo.attributes.position, uv = highlightGeo.attributes.uv
      const line = rightPage.markedLine
      for (let i = 0; i < positions.count; i++) {
        const x = line.x + uv.getX(i) * line.width * mark
        const y = line.bot - uv.getY(i) * (line.bot - line.top)
        // Page textures start at the top; the reader's surface v starts at the bottom.
        surface.pointAt(x / rightPage.tex.image.width, 1 - y / rightPage.tex.image.height, highlightPoint)
        positions.setXYZ(i, highlightPoint.x, highlightPoint.y, highlightPoint.z + .008)
      }
      positions.needsUpdate = true; highlightGeo.computeBoundingSphere()
    }
    renderer.clear()
    renderer.render(scene, camera)
    if (atlas.visible) { renderer.clearDepth(); renderer.render(atlasScene, atlasCamera) }
  }
  resize()
  return { update, resize, dispose() { disposed = true; model.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove() } }
}
