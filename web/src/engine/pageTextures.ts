import { getLocale } from '../i18n/runtime.ts'
import * as THREE from 'three'
import type { Annotation } from '../book/annotations'
import type { Paginated } from '../book/layout'
import { renderPage } from '../book/pageRender'
import type { FontSpec, FromWorker, ToWorker } from '../book/pageWorker'
import garamondLatin from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2?url'
import garamondLatinExt from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-ext-wght-normal.woff2?url'
import garamondLatinItalic from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2?url'
import garamondLatinExtItalic from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-ext-wght-italic.woff2?url'

export const TEX_SCALE = 2

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
const FONTS: FontSpec[] = [
  { url: garamondLatin, style: 'normal', range: LATIN },
  { url: garamondLatinExt, style: 'normal', range: LATIN_EXT },
  { url: garamondLatinItalic, style: 'italic', range: LATIN },
  { url: garamondLatinExtItalic, style: 'italic', range: LATIN_EXT },
]

const placeholder = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 4
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 4, 4)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
})()

interface Job {
  page: number
  /** lower runs first: 0 = a page the reader is looking at or about to see */
  prio: number
}

/**
 * Page textures, rasterised in a worker (OffscreenCanvas) so that turning many leaves never blocks the main thread.
 * A texture is handed out immediately (blank paper) and swapped for the finished bitmap when the worker is done.
 */
export class PageTextures {
  /** finished textures (LRU, most recent last) */
  private cache = new Map<number, THREE.Texture>()
  private wanted = new Set<number>()
  private marks: Annotation[] = []
  private maxAniso = 8
  private worker: Worker | null = null
  private nextId = 1
  private inflight = new Map<number, { page: number; version: number }>()
  private pending = new Map<number, Job>()
  private version = new Map<number, number>()
  private active = 0
  private focus = 0
  private syncRaf = 0
  /** called whenever a texture finished, so the owner can rebind it and redraw */
  onTextureReady?: () => void

  private pag: Paginated
  private title: string
  private author: string
  private images: Map<string, ImageBitmap>
  private limit: number

  constructor(pag: Paginated, title: string, author: string, images: Map<string, ImageBitmap>, limit = 28) {
    this.pag = pag
    this.title = title
    this.author = author
    this.images = images
    this.limit = limit
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        const w = new Worker(new URL('../book/pageWorker.ts', import.meta.url), { type: 'module' })
        w.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
        w.onerror = () => this.dropWorker()
        w.postMessage({ t: 'init', locale: getLocale(), fonts: [...FONTS, ...(pag.fonts ?? [])] } satisfies ToWorker)
        this.worker = w
      } catch {
        this.worker = null
      }
    }
  }

  setAnisotropy(n: number) {
    this.maxAniso = n
  }

  setMarks(marks: Annotation[], touched?: Set<number>) {
    this.marks = marks
    const pages = touched ?? new Set(this.cache.keys())
    for (const p of pages) if (this.cache.has(p)) this.request(p, 0)
  }

  get pageCount() {
    return this.pag.pages.length
  }

  /** Paint both faces of the exposed leaves before replacing an existing book.
   * Fonts and images are already loaded by pagination. Keep this bounded to the
   * current spread; the rest of the book still rasterises in the worker.
   */
  primeSpread(turned: number) {
    this.focus = 2 * turned
    for (let page = 2 * turned - 2; page <= 2 * turned + 1; page++) {
      const pg = this.pag.pages[page]
      if (!pg || this.cache.has(page)) continue
      const canvas = renderPage(pg, {
        cfg: this.pag.config, scale: TEX_SCALE, bookTitle: this.title,
        author: this.author, marks: this.marks, images: this.images,
      })
      this.finish(page, canvas as HTMLCanvasElement)
    }
  }

  private dropWorker() {
    this.worker?.terminate()
    this.worker = null
    this.inflight.clear()
    this.active = 0
    for (const p of this.wanted) this.request(p, 0)
    for (const p of this.cache.keys()) this.request(p, 1)
  }

  private marksFor(page: number) {
    const pg = this.pag.pages[page]
    return this.marks.filter((m) => m.locator.chapter === pg.chapter && m.locator.end > pg.start && m.locator.start < pg.end)
  }

  private request(page: number, prio: number) {
    this.version.set(page, (this.version.get(page) ?? 0) + 1)
    const cur = this.pending.get(page)
    if (!cur || prio < cur.prio) this.pending.set(page, { page, prio })
    if (this.worker) this.pump()
    else this.flushSync()
  }

  private takeNext() {
    let best: Job | undefined
    let bestScore = Infinity
    for (const j of this.pending.values()) {
      const score = j.prio * 100000 + Math.abs(j.page - this.focus)
      if (score < bestScore) {
        best = j
        bestScore = score
      }
    }
    if (!best) return undefined
    this.pending.delete(best.page)
    return best.page
  }

  /** without a worker support: raster one page per frame, so the main thread is at least never blocked for long */
  private flushSync() {
    if (this.syncRaf) return
    this.syncRaf = requestAnimationFrame(() => {
      this.syncRaf = 0
      const page = this.takeNext()
      if (page === undefined) return
      const pg = this.pag.pages[page]
      if (pg) {
        const canvas = renderPage(pg, { cfg: this.pag.config, scale: TEX_SCALE, bookTitle: this.title, author: this.author, marks: this.marks, images: this.images })
        this.finish(page, canvas as HTMLCanvasElement)
      }
      if (this.pending.size) this.flushSync()
    })
  }

  private pump() {
    const w = this.worker
    if (!w) return
    while (this.active < 2) {
      const page = this.takeNext()
      if (page === undefined) return
      const pg = this.pag.pages[page]
      if (!pg) continue
      const id = this.nextId++
      const images: Record<string, ImageBitmap> = {}
      for (const im of pg.images) {
        const bmp = this.images.get(im.path)
        if (bmp) images[im.path] = bmp
      }
      this.inflight.set(id, { page, version: this.version.get(page) ?? 0 })
      this.active++
      w.postMessage({
        t: 'render',
        id,
        page: pg,
        cfg: this.pag.config,
        scale: TEX_SCALE,
        title: this.title,
        author: this.author,
        marks: this.marksFor(page),
        images,
      } satisfies ToWorker)
    }
  }

  private onMessage(m: FromWorker) {
    if (m.t === 'ready') return
    if (m.t === 'fail') { this.dropWorker(); return }
    const job = this.inflight.get(m.id)
    this.inflight.delete(m.id)
    this.active = Math.max(0, this.active - 1)
    if (m.t === 'done') {
      const stale = !job || job.version !== (this.version.get(job.page) ?? 0)
      if (job && !stale) this.finish(job.page, m.bitmap)
      else m.bitmap.close()
    }
    this.pump()
  }

  private finish(page: number, image: HTMLCanvasElement | ImageBitmap) {
    const existing = this.cache.get(page)
    if (existing) {
      const old = existing.image as unknown
      existing.image = image
      // A prepainted DOM canvas can later be replaced by a flipped worker bitmap.
      existing.flipY = image instanceof HTMLCanvasElement
      existing.needsUpdate = true
      if (old instanceof ImageBitmap) old.close()
    } else {
      const tex = new THREE.Texture(image)
      tex.flipY = false
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = this.maxAniso
      tex.generateMipmaps = true
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.needsUpdate = true
      if (image instanceof HTMLCanvasElement) tex.flipY = true
      this.cache.set(page, tex)
      this.wanted.delete(page)
      this.evict()
    }
    this.onTextureReady?.()
  }

  private evict() {
    while (this.cache.size > this.limit) {
      let victim: number | undefined
      let far = -1
      for (const k of this.cache.keys()) {
        const d = Math.abs(k - this.focus)
        if (d > far) {
          far = d
          victim = k
        }
      }
      if (victim === undefined || far < 6) return
      const t = this.cache.get(victim)!
      t.dispose()
      this.cache.delete(victim)
    }
  }

  get(index: number): THREE.Texture {
    const tex = this.cache.get(index)
    if (tex) {
      this.cache.delete(index)
      this.cache.set(index, tex)
      return tex
    }
    if (index >= 0 && index < this.pag.pages.length && !this.wanted.has(index)) {
      this.wanted.add(index)
      this.request(index, 0)
    }
    return placeholder
  }

  /** warm pages around the reader, favouring the direction of travel, during idle frames */
  prefetchAround(turned: number, span = 8, dir = 0) {
    this.focus = 2 * turned
    for (let d = 0; d <= span; d++) {
      const order = dir >= 0 ? [turned + d, turned - 1 - d] : [turned - 1 - d, turned + d]
      for (const leaf of d === 0 ? [turned - 1, turned] : order) {
        if (leaf < 0) continue
        for (const p of [2 * leaf, 2 * leaf + 1]) {
          if (p >= this.pag.pages.length || this.cache.has(p) || this.wanted.has(p)) continue
          this.wanted.add(p)
          this.request(p, d <= 1 ? 0 : 1)
        }
      }
    }
  }

  dispose() {
    cancelAnimationFrame(this.syncRaf)
    this.worker?.terminate()
    this.worker = null
    for (const t of this.cache.values()) {
      if (t.image instanceof ImageBitmap) t.image.close()
      t.dispose()
    }
    this.cache.clear()
  }
}
