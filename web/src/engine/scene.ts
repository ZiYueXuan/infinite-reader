import type { Footnote } from '../book/types'
import { readerWheelIntent, type WebKitGesture } from './viewGestures'
import { DEFAULT_ENDPAPER, TILT_DEFAULT, TILT_MAX, TILT_MIN, TILT_PRESETS, type DeskId, type EndpaperId } from '../settings'
import * as THREE from 'three'
import { READER_FOV as FOV, updateReaderCamera } from './readerCamera'
import {hash, judouSymbolOf, type Annotation, type Locator} from '../book/annotations'
import { DEFAULT_LAYOUT, type LayoutConfig, type Paginated } from '../book/layout'
import { isPhoneBrowser, phoneLayout } from '../book/phoneLayout'
import { PhoneGestures } from './phoneGestures'
import { rangeRects, contentOrigin } from '../book/pageRender'
import { BOOK, BookModel } from './book'
import type { CoverSet } from './cover'
import { createDesk } from './desk'
import { NOTE_SIZE, NOTE_REST_CURL, NOTE_CURL_HEIGHT, TAB_H, TAB_W, NoteObject, type Pose } from './notes'
import { alignedNoteRotation } from './noteAlignment'
import { shadowRig } from './paperMaterial'
import { PageTextures } from './pageTextures'
import { TextLayer, type SelectionInfo } from './textLayer'
import type { BookMap } from '../atlas/catalog'
import { ImageLinkLayer, type ImageLink } from './imageLinkLayer'
import { NoteLinkLayer, type NoteLink } from './noteLinkLayer'
import { NoteHandleLayer, type NoteHandle } from './noteHandleLayer'
import { noteConnector, type Point } from './noteConnectorGeometry'
import { reflowTarget } from './reflowTarget'
import { CrossPageSelection } from './crossPageSelection'
import { canPageFrom, pageKeyDirection } from './readerKeyboard'

export interface LoadedBook {
  /** Desktop pagination keeps the existing cloud lastLeaf format device-independent. */
  progressPag?: Paginated
  id: string
  title: string
  author: string
  pag: Paginated
  images: Map<string, ImageBitmap>
  cover: CoverSet
  turned: number
  maps?: Map<string, BookMap>
}

export interface SceneHooks {
  onReaderTap?(): void
  onViewportChange?(): void
  selectionText?(locator: Locator): string
  onFootnoteClick?(note: Footnote, anchor: HTMLButtonElement): void
  onImageClick?(path: string, map: BookMap | null): void
  onSelection(sel: SelectionInfo | null): void

    /** the source range the reader wants to toggle a clause mark on; `keepCaret` when it came from a collapsed caret */
    onJudou?(locator: Locator, keepCaret: boolean): void
  onTurned(turned: number, open: boolean): void
  onMarkClick(id: string, rect: DOMRect): void
  onNoteTagClick?(tag: string, anchor: HTMLButtonElement): void
  onNoteClick(id: string, rect: DOMRect): void
  onNoteMoved(id: string, x: number, y: number, rot: number): void
  onBlankDeskClick(): void
  onOpenChange(open: boolean): void
  onZoom(zoom: number): void
  /** the camera tilt changed from inside the scene (drag, glide, T key); `persist` once it settled; `gesture` for user drags */
  onTilt(tilt: number, persist: boolean, gesture: boolean): void
}

const isPageImage = (image: { w: number; h: number }) => image.w > 0 && image.h > 0
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** tilt radians per pixel of vertical drag: the whole slider range in ~330 px */
const TILT_PER_PX = (TILT_MAX - TILT_MIN) / 330
const DRAG_START_PX = 4

interface DragState {
  kind: 'pan' | 'page' | 'cover' | 'note' | 'note-tab' | 'pinch' | 'tilt'
  id: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  lastT: number
  vx: number
  vy: number
  moved: boolean
  noteId?: string
  noteHandle?: boolean
  grabDX?: number
  grabDY?: number
  side?: 1 | -1
}

/*
 * three's PCF filter takes 5 jittered taps, which reads as a hard, grainy edge at the radii a soft lamp needs.
 * Widen it to 12 Vogel-disk taps (each a hardware 2x2 PCF) so a large radius stays smooth.
 */
{
  const src = THREE.ShaderChunk.shadowmap_pars_fragment
  const a = src.indexOf('shadow = (', src.indexOf('SHADOWMAP_TYPE_PCF )\n\n\t\tfloat getShadow'))
  const b = src.indexOf('* 0.2;', a)
  if (a > 0 && b > a) {
    THREE.ShaderChunk.shadowmap_pars_fragment =
      src.slice(0, a) +
      `float pcfAcc = 0.0;
\t\t\t\tfor ( int i = 0; i < 12; i ++ ) pcfAcc += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, 12, phi ) * radius, shadowCoord.z ) );
\t\t\t\tshadow = pcfAcc / 12.0;` +
      src.slice(b + '* 0.2;'.length)
  }
}

export class ReaderScene {
  readonly phone = isPhoneBrowser()
  phoneFontSize = (() => { try { return clamp(Number(localStorage.getItem('ir:phone-font-size')) || 20, 16, 28) } catch { return 20 } })()
  private sizeObserver: ResizeObserver
  private phoneGestures: PhoneGestures
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private desk = createDesk()
  private endpaper: EndpaperId = DEFAULT_ENDPAPER
  private spot: THREE.SpotLight
  private el: HTMLElement
  private canvas: HTMLCanvasElement
  private book: BookModel | null = null
  private loaded: LoadedBook | null = null
  private tex: PageTextures | null = null
  private text: TextLayer | null = null
  private crossSelection: CrossPageSelection | null = null
  private imageLinks: ImageLinkLayer | null = null
  private noteLinks: NoteLinkLayer | null = null
  private noteHandles: NoteHandleLayer | null = null
  private interactionSuspended = false
  private notes = new Map<string, NoteObject>()
  private editingNoteId: string | null = null
  private annotations: Annotation[] = []
  private zCounter = 0
  private hooks: SceneHooks

  private w = 1
  private h = 1
  private view = {
    x: 0,
    y: 0,
    zoom: 1,
    tx: 0,
    ty: 0,
    tzoom: 1,
    vx: 0,
    vy: 0,
    fx: 0,
    fy: 0,
    focus: false,
  }
  private fitDist = 40
  private raf = 0
  private last = 0
  private needsRender = true
  private drag: DragState | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private pinch: { dist: number; zoom: number } | null = null
  private nativeGesture: { zoom: number; x: number; y: number } | null = null
  private raycaster = new THREE.Raycaster()
  private disposed = false
  private readonly listeners = new AbortController()
  private lastTextSig = ''
  private selTimer = 0
  private pendingReveal: Locator | null = null
  private revealTimer = 0
  private keyTurns: { dir: 1 | -1; key: string; repeat: boolean }[] = []
  private mouseDown = false
  private nativeSelectionShown = false
  private onResize = () => this.resize()
  private viewportTimers: number[] = []
  private onViewportResize = () => {
    this.resize()
    if (!this.phone) return
    // Standalone WebKit may publish intermediate dimensions before rotation settles.
    this.viewportTimers.forEach(window.clearTimeout)
    this.viewportTimers = [120, 400, 900].map(delay => window.setTimeout(this.onResize, delay))
  }
  private lightDir = new THREE.Vector3()
  fps = 0
  paused = false
  private flutter: { t: number } | null = null
  private tilt = TILT_DEFAULT
  private tiltTarget = TILT_DEFAULT
  private tiltGlide = false
  private tiltReported = TILT_DEFAULT
  private tiltBlockUntil = 0
  private camSig = ''
  private panAnchor: { x: number; y: number } | null = null
  private panVel = { x: 0, y: 0, t: 0 }
  private fpsFrames = 0
  private fpsT = 0

  constructor(container: HTMLElement, hooks: SceneHooks) {
    this.el = container
    this.hooks = hooks
    this.phoneGestures = new PhoneGestures({
      begin: (side, _x, y) => {
        const b = this.book
        if (!b || b.busy || !b.beginDrag(side, .95, 1 - (y - this.el.getBoundingClientRect().top) / this.h)) return false
        this.clearSelection(); this.needsRender = true
        return true
      },
      move: (_side, dx, y) => {
        const b = this.book
        if (!b) return
        b.movePhoneDrag(dx / this.w, 1 - (y - this.el.getBoundingClientRect().top) / this.h)
        this.needsRender = true
      },
      end: (velocity, cancel) => {
        if (cancel) this.book?.cancelDrag()
        else this.book?.endDrag(velocity / this.w * 12, true)
        this.needsRender = true
      },
      tap: (x, y) => {
        if (this.book?.busy) return
        const mark = this.text?.markAt(x, y, this.annotations, document.elementFromPoint(x, y))
        if (mark) { this.hooks.onMarkClick(mark.id, new DOMRect(x - 2, y - 10, 4, 14)); return }
        const image = this.pickImage(x, y)
        if (image) { this.hooks.onImageClick?.(image.path, this.loaded?.maps?.get(image.path) ?? null); return }
        const fraction = (x - this.el.getBoundingClientRect().left) / this.w
        this.clearSelection()
        this.hooks.onSelection(null)
        if (fraction < .22) this.turn(-1)
        else if (fraction > .78) this.turn(1)
        else this.hooks.onReaderTap?.()
      },
      longPress: (x, y) => {
        if (this.interactionSuspended || this.book?.busy) return false
        const word = document.elementFromPoint(x, y)?.closest<HTMLElement>('.text-page .w')
        if (!word || !this.text?.root.contains(word) || !this.crossSelection) return false
        this.clearSelection()
        const locator = { chapter: Number(word.dataset.c), start: Number(word.dataset.s), end: Number(word.dataset.e) }
        this.crossSelection.startTouch(locator, x, y)
        return true
      },
      extendSelection: (x, y) => this.crossSelection?.moveTouch(x, y),
      endSelection: cancel => this.crossSelection?.endTouch(cancel || this.interactionSuspended),
    })
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.canvas = this.renderer.domElement
    this.canvas.className = 'desk-canvas'
    container.appendChild(this.canvas)

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 4, 900)
    this.scene.background = new THREE.Color(0x0b0705)
    this.scene.add(this.desk.mesh)
    if (this.phone) {
      this.desk.mesh.visible = false
      this.scene.background = new THREE.Color(0xf7f3e8)
    }

    // lamp: a warm pool of light with soft shadows, plus a dim fill
    this.spot = new THREE.SpotLight(0xffe9cf, 3.3, 0, 0.62, 1, 0)
    this.spot.position.set(-11, 13, 36)
    this.spot.target.position.set(0, 0, 0)
    this.spot.castShadow = true
    this.spot.shadow.mapSize.set(2048, 2048)
    this.spot.shadow.camera.near = 12
    this.spot.shadow.camera.far = 80
    this.spot.shadow.bias = -0.0007
    this.spot.shadow.normalBias = 0
    this.spot.shadow.radius = 11
    this.spot.shadow.intensity = 0.55
    this.scene.add(this.spot, this.spot.target)
    shadowRig.uLampW.value.copy(this.spot.position)
    this.scene.add(new THREE.HemisphereLight(0xfff3e2, 0x20140c, 0.55))
    const rim = new THREE.DirectionalLight(0xc8d8ff, 0.18)
    rim.position.set(14, -10, 20)
    this.scene.add(rim)

    this.lightDir.copy(this.spot.position).normalize()

    const { signal } = this.listeners
    const cv = this.canvas
    // Notes may cover selectable DOM text; hit-test them before that overlay receives the press.
    this.el.addEventListener('pointerdown', this.onPointerDown, { capture: true, signal })
    this.el.addEventListener('touchstart', this.onTextTouchStart, { passive: false, signal })
    cv.addEventListener('pointerleave', this.onPointerLeave, { signal })
    window.addEventListener('contextmenu', this.onContextMenu, { capture: true, signal })
    window.addEventListener('pointerdown', this.onTiltPress, { capture: true, signal })
    cv.addEventListener('lostpointercapture', this.onLostCapture, { signal })
    // Book text is a sibling overlay, so listen on their common parent, not just the canvas.
    this.el.addEventListener('wheel', this.onWheel, { capture: true, passive: false, signal })
    this.el.addEventListener('gesturestart', this.onGesture, { capture: true, passive: false, signal })
    window.addEventListener('gesturechange', this.onGesture, { capture: true, passive: false, signal })
    window.addEventListener('gestureend', this.onGesture, { capture: true, passive: false, signal })
    cv.addEventListener('dblclick', this.onDblClick, { signal })
    window.addEventListener('pointermove', this.onPointerMove, { signal })
    window.addEventListener('pointerup', this.onPointerUp, { signal })
    window.addEventListener('pointercancel', this.onPointerUp, { signal })
    window.addEventListener('blur', this.onDragInterrupted, { signal })
    window.addEventListener('keydown', this.onKey, { signal })
    window.addEventListener('keyup', this.onPageKeyUp, { signal })
    window.addEventListener('pointerdown', this.cancelKeyTurns, { capture: true, signal })
    window.addEventListener('focusin', this.onPageFocus, { signal })
    window.addEventListener('keydown', this.onZoomKey, { capture: true, signal })
    window.addEventListener('resize', this.onViewportResize, { signal })
    window.addEventListener('orientationchange', this.onViewportResize, { signal })
    window.addEventListener('pageshow', this.onViewportResize, { signal })
    window.visualViewport?.addEventListener('resize', this.onViewportResize, { signal })
    window.addEventListener('mousedown', this.onMouseDown, { capture: true, signal })
    window.addEventListener('mouseup', this.onMouseUp, { capture: true, signal })
    document.addEventListener('visibilitychange', this.onVisibility, { signal })
    document.addEventListener('selectionchange', this.onSelectionChange, { signal })

    this.resize()
    this.sizeObserver = new ResizeObserver(this.onResize)
    this.sizeObserver.observe(container)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ----------------------------- lifecycle ----------------------------- */

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.listeners.abort()
    this.sizeObserver.disconnect()
    this.viewportTimers.forEach(window.clearTimeout)
    this.phoneGestures.cancel(true)
    this.clearBook()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }

  invalidate() {
    this.needsRender = true
  }

  private resize() {
    const r = this.el.getBoundingClientRect()
    const changed = Math.abs(this.w - r.width) > 1 || Math.abs(this.h - r.height) > 1
    this.w = Math.max(1, r.width)
    this.h = Math.max(1, r.height)
    this.renderer.setSize(this.w, this.h, false)
    this.canvas.style.width = this.w + 'px'
    this.canvas.style.height = this.h + 'px'
    this.camera.aspect = this.w / this.h
    this.camera.updateProjectionMatrix()
    this.computeFit()
    this.needsRender = true
    if (this.phone && this.loaded && (changed || this.viewportNeedsReflow)) this.hooks.onViewportChange?.()
  }

  get viewportNeedsReflow() {
    const config = this.loaded?.pag.config
    if (!this.phone || !config) return false
    const expected = this.readingLayout(config)
    return (['pageW', 'pageH', 'marginTop', 'marginBottom', 'marginInner', 'marginOuter', 'fontSize'] as const)
      .some(key => expected[key] !== config[key])
  }

  readingLayout(base: LayoutConfig) {
    if (!this.phone) return base
    const css = getComputedStyle(this.el)
    const inset = (edge: string) => parseFloat(css.getPropertyValue(`--safe-${edge}`)) || 0
    return { ...phoneLayout(base, this.w, this.h, inset('top'), inset('bottom'), inset('left'), inset('right')), fontSize: this.phoneFontSize }
  }

  setPhoneFontSize(size: number) {
    this.phoneFontSize = clamp(size, 16, 28)
    try { localStorage.setItem('ir:phone-font-size', String(this.phoneFontSize)) } catch { /* Storage may be disabled. */ }
    this.hooks.onViewportChange?.()
  }

  /** Preserve the desktop cloud progress contract when phone pages have different dimensions. */
  get savedProgress() {
    const base = this.loaded?.progressPag, pag = this.loaded?.pag
    const page = pag?.pages[this.visiblePages.right]
    const lastLeaf = this.phone && base && page
      ? page.special ? 0 : Math.ceil(base.pageForOffset(page.chapter, page.start) / 2)
      : this.turnedLeaves
    const count = this.phone && base ? Math.ceil(base.pages.length / 2) : this.leafCount
    return { lastLeaf, lastPercent: Math.round(lastLeaf / Math.max(1, count) * 100) }
  }

  private computeFit() {
    const t = Math.tan((FOV * Math.PI) / 360)
    const needW = (BOOK.W * 2 + 2.6) * 1.12
    const needH = (BOOK.H + 2.2) * 1.12
    this.fitDist = Math.max(needH / 2 / t, needW / 2 / t / this.camera.aspect)
  }

  /* ------------------------------- book ------------------------------- */

  clearBook(retireBook?: (book: BookModel) => void) {
    this.phoneGestures.cancel(true)
    this.cancelKeyTurns()
    this.crossSelection?.dispose()
    this.crossSelection = null
    this.interactionSuspended = false
    this.cancelReveal()
    this.imageLinks?.dispose()
    this.imageLinks = null
    this.noteLinks?.dispose()
    this.noteLinks = null
    this.noteHandles?.dispose()
    this.noteHandles = null
    this.nativeGesture = null
    if (this.book) {
      this.scene.remove(this.book.group)
      if (retireBook) retireBook(this.book)
      else this.book.dispose()
      this.book = null
    }
    for (const n of this.notes.values()) {
      this.scene.remove(n.mesh, n.shadow)
      n.dispose()
    }
    this.notes.clear()
    this.text?.dispose()
    this.text = null
    this.tex?.dispose()
    this.tex = null
    this.loaded = null
    this.lastTextSig = ''
    this.flutter = null
    // The canvas keeps the last painted spread until the loop draws the empty desk.
    this.needsRender = true
  }

  loadBook(b: LoadedBook, open: boolean, primeSpread = false, retireBook?: (book: BookModel) => void) {
    b = { ...b, turned: clamp(b.turned, 0, this.phone ? b.pag.pages.length - 1 : Math.ceil(b.pag.pages.length / 2)) }
    const textures = new PageTextures(b.pag, b.title, b.author, b.images)
    textures.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()))
    textures.setMarks(this.annotations)
    try {
      if (primeSpread || this.phone) textures.primeSpread(this.phone ? b.turned / 2 : b.turned)
    } catch (error) {
      textures.dispose()
      throw error
    }
    // Keep the old spread intact until its replacement has real page textures.
    this.clearBook(retireBook)
    this.loaded = b
    this.tex = textures
    this.tex.onTextureReady = () => {
      this.book?.refreshTextures()
      this.needsRender = true
    }
    this.text = new TextLayer(this.el, b.pag.config, (id, rect) => {
      if (this.interactionSuspended || !this.book?.fullyOpen || this.book.busy || this.drag) return
      this.clearSelection()
      this.hooks.onSelection(null)
      this.hooks.onNoteClick(id, rect)
    }, (note, anchor) => {
      if (this.interactionSuspended || !this.book?.fullyOpen || this.book.busy || this.drag) return
      this.clearSelection()
      this.hooks.onSelection(null)
      this.hooks.onFootnoteClick?.(note, anchor)
    }, (tag, anchor) => {
      if (this.interactionSuspended || !this.book?.fullyOpen || this.book.busy || this.drag) return
      this.clearSelection()
      this.hooks.onSelection(null)
      this.hooks.onNoteTagClick?.(tag, anchor)
    })
    this.imageLinks = new ImageLinkLayer(this.el, (path) => {
      if (!this.interactionSuspended && this.book?.fullyOpen && !this.book.busy && !this.drag) this.hooks.onImageClick?.(path, this.loaded?.maps?.get(path) ?? null)
    })
    const leafCount = this.phone ? b.pag.pages.length : Math.ceil(b.pag.pages.length / 2)
    this.book = new BookModel({
      singlePage: this.phone,
      pageHeight: this.phone ? BOOK.W * b.pag.config.pageH / b.pag.config.pageW : undefined,
      leafCount,
      turned: b.turned,
      open,
      getTexture: (p) => this.tex!.get(this.phone ? Math.floor(p / 2) : p),
      cover: b.cover,
      endpaper: this.endpaper,
    })
    this.book.onSettle = (turned, isOpen) => {
      this.hooks.onTurned(turned, isOpen)
      this.tex?.prefetchAround(this.phone ? turned / 2 : turned)
    }
    this.crossSelection = new CrossPageSelection(this.text, {
      phone: this.phone,
      ready: () => !!this.book?.fullyOpen && !this.book.busy && !this.drag && !this.interactionSuspended,
      pagination: () => this.loaded!.pag,
      text: locator => this.hooks.selectionText?.(locator) ?? '',
      select: selection => this.hooks.onSelection(selection),
      turn: () => {
        this.clearPageHint()
        this.book!.turn(1, 1, 'quick')
        this.needsRender = true
      },
    })
    this.scene.add(this.book.group)
    this.book.setLightDir(this.viewLightDir())
    this.tex.prefetchAround(this.phone ? b.turned / 2 : b.turned)
    this.book.update(0)
    this.syncNotes(true)
    this.frameBook(false)
    this.needsRender = true
    // A load/font request can finish after the viewport that started it has changed.
    this.resize()
  }

  /** Rebuild pagination around the current passage, retaining the reader's camera. */
  reflow(pag: Paginated, noteId?: string) {
    if (!this.loaded) return
    const loaded = this.loaded
    const target = reflowTarget(loaded.pag, pag, [this.visiblePages.left, this.visiblePages.right], noteId)
    // An outside press can both finish editing and begin a page/desk drag while
    // pagination runs. End that gesture before replacing the model it belongs to.
    this.onDragInterrupted()
    const view = { ...this.view }
    const open = this.isOpen
    const suspended = this.interactionSuspended
    let retired: BookModel | undefined
    try {
      // Disposing every old paper material first evicts its shared GPU programs.
      // Keep them alive through the replacement's first render to avoid recompilation.
      this.loadBook({ ...loaded, pag, turned: this.pageToLeafTurned(target) }, open, true, book => { retired = book })
      // A picture/map modal may open while its outside click finishes note editing.
      // Rebuilding the book must not revoke the modal's ownership of reader input.
      if (suspended) this.suspendInteraction(true)
      Object.assign(this.view, view)
      this.renderNow()
    } finally { retired?.dispose() }
  }

  get isOpen() {
    return !!this.book && this.book.isOpen
  }

  get pagination() {
    return this.loaded?.pag ?? null
  }

  get hasBook() {
    return !!this.book
  }

  get turnedLeaves() {
    return this.book?.turned ?? 0
  }

  get leafCount() {
    return this.book?.N ?? 0
  }

  /** current visible page indices (left, right) */
  get visiblePages() {
    if (!this.book) return { left: -1, right: -1 }
    const t = this.book.settledTurned
    return this.phone ? { left: -1, right: t } : { left: 2 * t - 1, right: 2 * t }
  }

  private viewLightDir() {
    const v = this.lightDir.clone()
    v.transformDirection(this.camera.matrixWorldInverse)
    return v
  }

  setOpen(open: boolean) {
    if (this.phone) return
    const b = this.book
    if (!b) return
    const want = open ? Math.PI : 0
    // compare the rest angle, not just the side of the midpoint: a half-open target must still be completed
    if (b.isOpen === open && b.psiTarget === want && !b.coverHeld) return
    if (!open) {
      // collapse free notes into the book
      this.clearSelection()
      b.setOpen(false)
      this.flyNotesIn()
      this.hooks.onOpenChange(false)
      this.frameBook(true, false)
    } else {
      b.setOpen(true)
      this.flyNotesOut()
      this.hooks.onOpenChange(true)
      this.frameBook(true, true)
    }
    this.needsRender = true
  }

  turn(dir: 1 | -1, count = 1) {
    this.cancelKeyTurns()
    this.performTurn(dir, count)
  }

  /** True means accepted (including reaching a boundary); false means try after animation. */
  private performTurn(dir: 1 | -1, count = 1, quick = false): boolean {
    const b = this.book
    if (!b) return false
    if (!b.isOpen) {
      if (b.busy) return false
      if (dir === 1) this.setOpen(true)
      return true
    }
    if (dir === -1 && b.settledTurned === 0 && !b.busy) {
      if (this.phone) return true
      this.setOpen(false)
      return true
    }
    const started = b.turn(dir, count, quick ? 'quick' : 'natural')
    if (!started) return !b.busy && b.fullyOpen
    this.canvas.style.cursor = ''
    this.clearSelection()
    this.needsRender = true
    return true
  }

  /** jump to a spread, flipping a handful of leaves for the effect */
  goToLeaf(targetTurned: number) {
    this.cancelKeyTurns()
    const b = this.book
    if (!b) return
    targetTurned = clamp(targetTurned, 0, this.phone ? b.N - 1 : b.N)
    if (this.phone) {
      // Contents/progress seeking selects a page, rather than fanning several sheets at once.
      this.phoneGestures.cancel(true)
      this.clearSelection()
      this.tex?.primeSpread(targetTurned / 2)
      b.jumpTo(targetTurned)
      this.tex?.prefetchAround(targetTurned / 2)
      this.hooks.onTurned(targetTurned, true)
      this.needsRender = true
      return
    }
    if (!b.isOpen) {
      b.jumpTo(targetTurned)
      this.setOpen(true)
      return
    }
    this.clearSelection()
    const diff = targetTurned - b.turned
    if (diff === 0) return
    const dir: 1 | -1 = diff > 0 ? 1 : -1
    const n = Math.abs(diff)
    const fan = Math.min(n, 6)
    if (n > fan) b.jumpTo(targetTurned - dir * fan)
    b.turn(dir, fan)
    this.tex?.prefetchAround(this.phone ? targetTurned / 2 : targetTurned)
    this.needsRender = true
  }

  pageToLeafTurned(pageIndex: number) {
    if (this.phone) return pageIndex
    // spread whose right page (or left page) contains this page
    return Math.floor(pageIndex / 2) + (pageIndex % 2 === 0 ? 0 : 1)
  }

  /* --------------------------- annotations --------------------------- */

  setEditingNote(id: string | null) {
    if (this.disposed || this.editingNoteId === id) return
    this.editingNoteId = id
    for (const n of this.notes.values()) n.mesh.visible = n.shadow.visible = n.id !== id
    // Paint with the editor's layout effect so the old canvas cannot show a duplicate for one frame.
    this.renderNow()
  }

  setAnnotations(list: Annotation[]) {
    const prev = new Map(this.annotations.map((a) => [a.id, a]))
    this.annotations = list
    const touched = new Set<number>()
    const pag = this.loaded?.pag
    const mark = (a: Annotation) => {
      if (!pag) return
      for (const p of pag.pages) {
        if (p.chapter === a.locator.chapter && !p.special && a.locator.end > p.start && a.locator.start < p.end) touched.add(p.index)
      }
    }
    for (const a of list) {
      const o = prev.get(a.id)
        if (!o || o.kind !== a.kind || o.color !== a.color || o.locator.start !== a.locator.start || o.locator.end !== a.locator.end || judouSymbolOf(o.symbol) !== judouSymbolOf(a.symbol)) {
        mark(a)
        if (o) mark(o)
      }
      prev.delete(a.id)
    }
    for (const a of prev.values()) mark(a)
    this.tex?.setMarks(list, touched)
    this.syncNotes(false)
    this.needsRender = true
  }

  private syncNotes(_initial: boolean) {
    // Notes now belong to paginated content. Keep legacy coordinates in storage,
    // but never instantiate desk paper, connectors, drag handles or cover tabs.
    for (const note of this.notes.values()) {
      this.scene.remove(note.mesh, note.shadow)
      note.dispose()
    }
    this.notes.clear()
  }

  private noteFreePose(n: NoteObject): Pose {
    const p = n.freePose
    const z = this.freeZ(p.x, p.y, n.zOrder)
    p.rot = this.noteRestRotation(p.x, p.y, z)
    return {
      x: p.x,
      y: p.y,
      z,
      rot: p.rot,
      curl: NOTE_REST_CURL,
      droop: 0,
      lipY: 0,
      zTab: 0,
      fold: 0,
    }
  }

  private noteRestRotation(x: number, y: number, z: number) {
    const b = this.book
    if (!b?.fullyOpen) return 0
    const side = x >= b.group.position.x ? 1 : -1
    const edgeX = b.group.position.x + side * b.W
    const edgeZ = b.stackTop(side)
    return alignedNoteRotation(
      { x, y, z, size: NOTE_SIZE, curlRise: NOTE_REST_CURL * NOTE_CURL_HEIGHT },
      side,
      [this.project(edgeX, b.H / 2, edgeZ), this.project(edgeX, -b.H / 2, edgeZ)],
      (px, py, pz) => this.project(px, py, pz),
    )
  }

  private freeZ(x: number, y: number, order: number) {
    const b = this.book
    let z = 0.03
    if (b && b.fullyOpen) {
      const half = NOTE_SIZE * 0.5
      if (Math.abs(x) < BOOK.W + half && Math.abs(y) < BOOK.H / 2 + half) {
        const side: 1 | -1 = x >= 0 ? 1 : -1
        z = Math.max(z, b.stackTop(side) + 0.03)
      }
    }
    return z + order * 0.0025
  }

  /** order notes by their position in the book */
  private tabOrder() {
    const pag = this.loaded?.pag
    const list = this.annotations.filter((a) => a.note)
    return list
      .map((a) => ({
        a,
        page: pag ? pag.pageForOffset(a.locator.chapter, a.locator.start) : 0,
      }))
      .sort((x, y) => x.page - y.page || x.a.locator.start - y.a.locator.start)
  }

  private tabPoseFor(a: Annotation): Pose {
    const b = this.book!
    const order = this.tabOrder()
    const idx = Math.max(
      0,
      order.findIndex((o) => o.a.id === a.id),
    )
    const n = order.length
    const Wb = b.W + b.OH
    const groupX = -(b.W / 2 + b.zh * 0.1)
    const vis = 1.3
    const margin = TAB_H * 0.5 + 0.5
    const spacing = n > 1 ? Math.min(TAB_H + 0.22, (b.H - 2 * margin) / (n - 1)) : 0
    const yTop = (spacing * (n - 1)) / 2
    const seed = (hash(a.id) % 1000) / 1000 - 0.5
    // slots go down the fore-edge in reading order; each flag sits between the pages it belongs to
    const leaf = Math.floor(order[idx].page / 2)
    const block = b.t * b.N
    const zPage = b.tb + b.t * (b.N - leaf)
    const zTab = Math.min(zPage, b.tb + block - 0.05) - idx * 0.004
    return {
      x: groupX + Wb + vis - TAB_W / 2 + seed * 0.14,
      y: yTop - idx * spacing + seed * 0.08,
      z: zTab,
      rot: seed * 0.07,
      curl: 0,
      droop: 0,
      lipY: 0,
      zTab,
      fold: 1,
    }
  }

  private flyNotesIn() {
    const b = this.book!
    let i = 0
    for (const a of this.tabOrder().map((o) => o.a)) {
      const n = this.notes.get(a.id)
      if (!n) continue
      const target = this.tabPoseFor(a)
      n.tabPose = target
      n.flyTo('in', target, 0.75, 0.02 + i * 0.05)
      n.held = false
      i++
    }
    void b
  }

  private flyNotesOut() {
    let i = 0
    for (const a of this.tabOrder().map((o) => o.a)) {
      const n = this.notes.get(a.id)
      if (!n) continue
      n.freePose.x = a.note!.x
      n.freePose.y = a.note!.y
      const target = { ...this.noteFreePose(n) }
      n.flyTo('out', target, 0.85, i * 0.05)
      i++
    }
  }

  /** a spot beside the page where a passage lives, for a freshly created sticky note */
  suggestNotePos(loc: Locator): { x: number; y: number; rot: number } {
    const pag = this.loaded?.pag
    const cfg = DEFAULT_LAYOUT
    let x = BOOK.W + NOTE_SIZE * 0.7
    let y = 0
    if (pag) {
      const pi = pag.pageForOffset(loc.chapter, loc.start)
      // find the actual page holding loc.start
      let page = pag.pages[pi]
      for (let i = pi; i < Math.min(pag.pages.length, pi + 3); i++) {
        if (pag.pages[i].chapter === loc.chapter && pag.pages[i].start <= loc.start && pag.pages[i].end > loc.start) page = pag.pages[i]
      }
      const rects = rangeRects(page, loc.start, loc.end)
      const o = contentOrigin(page, cfg)
      if (rects.length) y = BOOK.H / 2 - ((o.y + rects[0].line.y) / cfg.pageH) * BOOK.H
      x = (page.index % 2 === 0 ? 1 : -1) * (BOOK.W + NOTE_SIZE * 0.62)
    }
    const side = Math.sign(x) || 1
    const taken = [...this.notes.values()].map((n) => n.freePose)
    const gap = NOTE_SIZE * 1.06
    const free = (cx: number, cy: number) => taken.every((t) => Math.abs(t.x - cx) > gap || Math.abs(t.y - cy) > gap)
    const yMax = BOOK.H / 2
    const rnd = (Math.sin(taken.length * 12.9898 + y) * 43758.5453) % 1
    let best = { x: x + side * NOTE_SIZE * 0.1, y: clamp(y - 0.6, -yMax, yMax) }
    search: for (let col = 0; col < 4; col++) {
      for (let k = 0; k < 9; k++) {
        const dy = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * gap * 0.95
        const cx = x + side * col * gap * 0.95
        const cy = clamp(y - 0.6 + dy, -yMax - 0.5, yMax + 0.5)
        if (free(cx, cy)) {
          best = { x: cx, y: cy }
          break search
        }
      }
    }
    return { x: best.x + (rnd - 0.5) * 0.25, y: best.y + (rnd - 0.5) * 0.25, rot: 0 }
  }

  focusNote(id: string) {
    this.revealNote(id)
  }

  /** Bring an inline note's first fragment into view without changing the camera. */
  revealNote(id: string) {
    const book = this.book, pag = this.loaded?.pag
    if (!book || !pag) return
    const visible = [this.visiblePages.left, this.visiblePages.right]
    const page = pag.pages.find((page) => visible.includes(page.index) && page.notes?.some((note) => note.id === id))
      ?? pag.pages.find((page) => page.notes?.some((note) => note.id === id))
    if (!page) return
    this.clearSelection()
    // Opening a note is a direct navigation, so the editor can anchor in the same turn.
    book.jumpTo(this.pageToLeafTurned(page.index))
    if (!book.isOpen) this.setOpen(true)
    book.update(0)
    this.tex?.prefetchAround(book.turned)
    this.hooks.onTurned(book.turned, book.isOpen)
    this.renderNow()
  }

  noteScreenPose(id: string) {
    const rect = this.noteScreenRect(id)
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, rotation: 0 } : null
  }

  noteScreenRect(id: string) {
    this.updateCamera()
    this.syncTextLayer()
    return this.text?.noteScreenRect(id) ?? null
  }

  /* ------------------------------ camera ------------------------------ */

  private frameBook(animate: boolean, open = this.book?.isOpen ?? true) {
    const z = open ? 0.9 : 0.9
    this.view.tzoom = z
    this.view.focus = false
    this.view.tx = 0
    this.view.ty = 0
    if (!animate) {
      this.view.zoom = z
      this.view.x = 0
      this.view.y = 0
    }
    this.view.vx = this.view.vy = 0
    this.needsRender = true
  }

  zoomBy(f: number) {
    if (this.phone) return
    this.view.tzoom = clamp(this.view.tzoom * f, 0.12, 7)
    this.view.focus = false
    this.needsRender = true
  }

  /** slide the desk so content moves by (dx, dy) screen pixels */
  nudgePx(dx: number, dy = 0) {
    const cx = this.w / 2
    const cy = this.h / 2
    const a = this.unproject(cx, cy, 0)
    const b = this.unproject(cx + dx, cy + dy, 0)
    this.view.focus = false
    this.view.tx = this.view.x - (b.x - a.x)
    this.view.ty = this.view.y - (b.y - a.y)
    this.needsRender = true
  }

  /** Switch the desk material without rebuilding the scene or its lighting. */
  setDesk(id: DeskId) {
    this.desk.setSurface(id)
    this.needsRender = true
  }

  setEndpaper(id: EndpaperId) {
    this.endpaper = id
    this.book?.setEndpaper(id)
    this.needsRender = true
  }

  /** camera pitch in radians (0 = straight down); eases to the target unless `animate` is false */
  setTilt(rad: number, animate = true) {
    if (this.phone) { this.tilt = this.tiltTarget = 0; return }
    rad = clamp(rad, TILT_MIN, TILT_MAX)
    this.tiltTarget = rad
    if (!animate) this.tilt = rad
    this.tiltGlide = false
    this.needsRender = true
  }

  get debugTilt() {
    return this.tilt
  }
  set debugTilt(v: number) {
    this.tilt = this.tiltTarget = v
  }

  resetView() {
    this.frameBook(true)
  }

  /** frame one page (side) for comfortable reading */
  focusPage(side: 1 | -1 | 0) {
    if (this.phone) return
    this.view.focus = false
    if (side === 0) {
      this.frameBook(true)
      return
    }
    const t = Math.tan((FOV * Math.PI) / 360)
    const needH = (BOOK.H + 1.2) * 1.04
    const needW = (BOOK.W + 1.0) * 1.04
    const dist = Math.max(needH / 2 / t, needW / 2 / t / this.camera.aspect)
    this.view.tzoom = this.fitDist / dist
    this.view.tx = side * (BOOK.W / 2)
    this.view.ty = 0
    this.needsRender = true
  }

  private get dist() {
    return this.fitDist / this.view.zoom
  }

  project(x: number, y: number, z: number) {
    this.updateCamera()
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h }
  }

  /** intersect the view ray through a pixel with the horizontal plane at height z */
  unproject(px: number, py: number, z: number) {
    this.updateCamera()
    const ndc = new THREE.Vector3((px / this.w) * 2 - 1, -((py / this.h) * 2 - 1), 0.5).unproject(this.camera)
    const o = this.camera.position
    const dir = ndc.sub(o)
    const t = (z - o.z) / dir.z
    return { x: o.x + dir.x * t, y: o.y + dir.y * t }
  }

  private localPoint(clientX: number, clientY: number, z = 0.3) {
    const r = this.el.getBoundingClientRect()
    const p = this.unproject(clientX - r.left, clientY - r.top, z)
    const gx = this.book?.group.position.x ?? 0
    return { wx: p.x, wy: p.y, bx: p.x - gx, by: p.y }
  }

  /* ----------------------------- interaction ----------------------------- */

  private pickNote(clientX: number, clientY: number): NoteObject | null {
    const b = this.book
    if (!b) return null
    const r = this.el.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const meshes = [...this.notes.values()].filter((n) => n.mesh.visible && n.state === (b.isOpen ? 'free' : 'tab')).map((n) => n.mesh)
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (!hits.length) return null
    if (!b.isOpen) {
      // Only the exposed, frontmost flag is clickable; the cover hides the tucked-in edge.
      const coverHit = this.raycaster.intersectObject(b.group, true).find((h) => h.object.visible)
      if (coverHit && coverHit.distance < hits[0].distance) return null
      return this.notes.get(hits[0].object.userData.noteId) ?? null
    }
    // topmost: nearest to camera in z-order
    let best: NoteObject | null = null
    for (const h of hits) {
      const n = this.notes.get(h.object.userData.noteId)
      if (n && (!best || n.zOrder > best.zOrder)) best = n
    }
    return best
  }

  private isUiTarget(t: EventTarget | null) {
    return t instanceof Element && !!t.closest('[data-ui]')
  }

  /** Paper-attached note targets block clicks from selecting/turning pages, but share desk pan/zoom. */
  private isZoomUiTarget(t: EventTarget | null) {
    return this.isUiTarget(t) && !(t instanceof Element && t.closest('.note-drag-handle, .inline-note-hit, .inline-note-tag-hit, .inline-note-link-hit'))
  }

  /** A modal owns input and rendering while preserving the exact reader camera and leaf state. */
  suspendInteraction(suspended: boolean) {
    if (suspended) this.clearSelection()
    this.interactionSuspended = suspended
    this.imageLinks?.setVisible(!suspended)
    if (suspended) this.noteLinks?.update([])
    if (suspended) {
      this.noteHandles?.update([])
      this.onDragInterrupted()
      this.clearPageHint()
    }
    this.last = performance.now()
    this.needsRender = true
  }

  private pickImage(clientX: number, clientY: number) {
    const b = this.book, loaded = this.loaded
    if (!b?.fullyOpen || b.busy || !loaded || this.interactionSuspended) return null
    const r = this.el.getBoundingClientRect()
    this.raycaster.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, 1 - (clientY - r.top) / r.height * 2), this.camera)
    const surfaces = ([-1, 1] as const).flatMap((side) => {
      const surface = b.pageSurface(side)
      if (!surface) return []
      surface.mesh.updateWorldMatrix(true, false)
      surface.geo.computeBoundingSphere()
      return [{ side, surface }]
    })
    const hit = this.raycaster.intersectObjects(surfaces.map(({ surface }) => surface.mesh), false)[0]
    if (!hit?.uv) return null
    const side = surfaces.find(({ surface }) => surface.mesh === hit.object)!.side
    const page = loaded.pag.pages[side === 1 ? this.visiblePages.right : this.visiblePages.left]
    if (!page) return null
    const cfg = loaded.pag.config, origin = contentOrigin(page, cfg)
    const x = (side === 1 ? hit.uv.x : 1 - hit.uv.x) * cfg.pageW - origin.x
    const y = (1 - hit.uv.y) * cfg.pageH - origin.y
    const image = page.images.find((im) => isPageImage(im) && x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h)
    return image ?? null
  }

  /** right button, or Alt/Option + left button: drag vertically to tilt the camera */
  private isTiltPress(e: PointerEvent | MouseEvent) {
    return e.button === 2 || (e.button === 0 && e.altKey)
  }

  private isDeskTarget(t: EventTarget | null) {
    return t === this.canvas || (t instanceof HTMLElement && !!t.closest('.text-layer') && !t.closest('[data-ui]'))
  }

  private onTiltPress = (e: PointerEvent) => {
    if (this.phone) return
    if (this.interactionSuspended) return
    if (!this.isTiltPress(e) || (e as PointerEvent).pointerType === 'touch') return
    if (!this.isDeskTarget(e.target)) return
    this.tiltBlockUntil = performance.now() + 700
    const stale = this.drag
    if (stale) {
      // a right press must never cancel or corrupt a left-button drag that is in progress
      if (e.button === 2 && stale.kind !== 'tilt') return
      if (stale.kind !== 'pinch') this.finishDrag(stale.lastX, stale.lastY)
      else return
    }
    e.preventDefault()
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.flutter = null
    try {
      this.canvas.setPointerCapture?.(e.pointerId)
    } catch {
      /* synthetic or already-released pointer */
    }
    this.tiltGlide = false
    this.tiltTarget = this.tilt
    this.drag = {
      kind: 'tilt',
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    }
    this.canvas.style.cursor = 'ns-resize'
  }

  /**
   * Phone book text belongs to the reader's selection tools. Desktop text keeps its browser menu unless tilting;
   * the canvas suppresses it for right-drag tilt. Do not interrupt a drag when no menu is opened.
   */
  private onContextMenu = (e: MouseEvent) => {
    const t = e.target
    if (this.isUiTarget(t)) {
      this.onDragInterrupted()
      return
    }
    if (t === this.canvas || (this.isDeskTarget(t) && (this.phone || this.drag?.kind === 'tilt' || performance.now() < this.tiltBlockUntil))) {
      e.preventDefault()
    }
  }

  private onTextTouchStart = (e: TouchEvent) => {
    // iOS callouts start from touch defaults, not only contextmenu. Keep editors and UI native.
    if (this.phone && !this.interactionSuspended && !this.isUiTarget(e.target) &&
      e.target instanceof Element && e.target.closest('.text-page .w') && e.cancelable) e.preventDefault()
  }

  /** step to the next viewing-angle preset (key T) */
  cycleTilt() {
    const ps = TILT_PRESETS.map((p) => p.value as number)
    const cur = this.tiltTarget
    const near = ps.findIndex((v) => Math.abs(v - cur) < 0.03)
    const next = near >= 0 ? ps[(near + 1) % ps.length] : (ps.find((v) => v > cur) ?? ps[0])
    this.setTilt(next, true)
    this.tiltGlide = true
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.interactionSuspended) return
    if (this.phone) {
      // Admit a second finger even while selection is turning a page, so it can cancel the gesture.
      if ((!this.book || this.book.busy) && !this.phoneGestures.turning && !this.phoneGestures.selecting) return
      if (this.phoneGestures.selecting || (!this.isUiTarget(e.target) && this.isDeskTarget(e.target))) {
        this.phoneGestures.down(e)
        // Keep receiving touch events when a turn replaces the original word's DOM node.
        if (e.isTrusted) this.el.setPointerCapture(e.pointerId)
      }
      return
    }
    const handle = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.note-drag-handle') : null
    if (this.isUiTarget(e.target) && !handle) return
    if (this.isTiltPress(e)) return
    const note = e.button === 0 ? (handle ? this.notes.get(handle.dataset.noteId!) : this.pickNote(e.clientX, e.clientY)) : null
    if (handle && (!note?.mesh.visible || note.state !== 'free' || !this.book?.fullyOpen || this.book.busy)) return
    // An uncovered word still belongs to native text selection, never to the desk's pan gesture.
    if (e.target !== this.canvas && !handle && (!this.isDeskTarget(e.target) || !note)) return
    if (note) {
      e.preventDefault()
      e.stopPropagation()
      this.clearPageHint()
      this.clearSelection()
    }
    {
      // a press while another drag is still open means its up event was lost: close it out before starting anew
      const stale = this.drag
      if (stale && stale.kind !== 'pinch' && !(this.pointers.size >= 1 && e.pointerId !== stale.id)) {
        this.finishDrag(stale.lastX, stale.lastY)
      }
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.flutter = null
    try {
      this.canvas.setPointerCapture?.(e.pointerId)
    } catch {
      /* synthetic or already-released pointer */
    }
    if (this.pointers.size === 2) {
      // A second finger takes ownership without leaving the first note lifted or held.
      if (this.drag?.kind === 'note') this.finishDrag(this.drag.lastX, this.drag.lastY)
      const [a, b] = [...this.pointers.values()]
      this.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: this.view.tzoom,
      }
      this.drag = {
        kind: 'pinch',
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastT: performance.now(),
        vx: 0,
        vy: 0,
        moved: true,
      }
      return
    }
    const now = performance.now()
    const base: DragState = {
      kind: 'pan',
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: now,
      vx: 0,
      vy: 0,
      moved: false,
    }
    this.view.vx = this.view.vy = 0
    this.view.focus = false
    {
      const r = this.el.getBoundingClientRect()
      this.panAnchor = this.unproject(e.clientX - r.left, e.clientY - r.top, 0)
      this.panVel = { x: 0, y: 0, t: now }
    }

    // sticky note?
    if (note) {
      if (note.state === 'tab') {
        base.kind = 'note-tab'
        base.noteId = note.id
        this.drag = base
        this.canvas.style.cursor = 'pointer'
        return
      }
      const p = this.localPoint(e.clientX, e.clientY, note.pose.z)
      base.kind = 'note'
      base.noteId = note.id
      base.noteHandle = !!handle
      base.grabDX = note.pose.x - p.wx
      base.grabDY = note.pose.y - p.wy
      note.zOrder = ++this.zCounter
      note.held = true
      note.liftTarget = 1
      note.dirty = true
      this.drag = base
      this.canvas.style.cursor = 'grabbing'
      return
    }

    const b = this.book
    if (b && e.button === 0) {
      const p = this.localPoint(e.clientX, e.clientY)
      const zone = b.zoneAt(p.bx, p.by)
      if (zone?.zone === 'cover' && b.psi < 0.05) {
        base.kind = 'cover'
        b.beginCoverDrag()
        this.drag = base
        return
      }
      if (zone?.zone === 'page' && this.inGrabZone(zone.u, zone.v) && !this.pickImage(e.clientX, e.clientY)) {
        if (zone.side === -1 && b.settledTurned === 0 && !b.busy) {
          base.kind = 'cover'
          base.side = -1
          b.beginCoverDrag()
          this.drag = base
          return
        }
        if (b.beginDrag(zone.side, zone.u, zone.v)) {
          base.kind = 'page'
          base.side = zone.side
          this.drag = base
          this.clearSelection()
          this.canvas.style.cursor = 'grabbing'
          this.needsRender = true
          return
        }
      }
    }
    this.drag = base
    this.canvas.style.cursor = 'grabbing'
  }

  private inGrabZone(u: number, v: number) {
    const cfg = DEFAULT_LAYOUT
    const textL = cfg.marginInner / cfg.pageW
    const textR = 1 - cfg.marginOuter / cfg.pageW
    const textB = cfg.marginBottom / cfg.pageH
    const textT = 1 - cfg.marginTop / cfg.pageH
    const inText = u > textL && u < textR && v > textB && v < textT
    if (inText) return false
    return u > 0.5
  }

  private onPointerLeave = () => {
    if (this.drag) return
    if (this.book?.peelAmount && !this.flutter) {
      this.book.setPeel(0, 1, 0.5)
      this.needsRender = true
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.phone) { this.phoneGestures.move(e); return }
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const d = this.drag
    const b = this.book
    if (!d) {
      this.hover(e)
      return
    }
    if (d.kind === 'pinch' && this.pinch && this.pointers.size >= 2) {
      const [p1, p2] = [...this.pointers.values()]
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y)
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      this.setZoomAt(this.pinch.zoom * (dist / this.pinch.dist), mid.x, mid.y, true)
      return
    }
    if (e.pointerId !== d.id) return
    const now = performance.now()
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    const dt = Math.max(1, now - d.lastT) / 1000
    d.vx = d.vx * 0.6 + (dx / dt) * 0.4
    d.vy = d.vy * 0.6 + (dy / dt) * 0.4
    d.lastX = e.clientX
    d.lastY = e.clientY
    d.lastT = now
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_START_PX) d.moved = true

    if (d.kind === 'tilt') {
      if (e.buttons === 0 && e.pointerType !== 'touch' && e.isTrusted) {
        this.finishDrag(e.clientX, e.clientY)
        return
      }
      if (!d.moved) return
      this.tiltTarget = clamp(this.tiltTarget - dy * TILT_PER_PX, TILT_MIN, TILT_MAX)
      this.needsRender = true
      return
    }
    if (d.kind === 'pan') {
      if (!d.moved) return
      const r = this.el.getBoundingClientRect()
      const anchor = this.panAnchor
      if (anchor) {
        const cur = this.unproject(e.clientX - r.left, e.clientY - r.top, 0)
        const mx = anchor.x - cur.x
        const my = anchor.y - cur.y
        this.view.x += mx
        this.view.y += my
        const pv = this.panVel
        const pdt = Math.max(0.001, (now - pv.t) / 1000)
        pv.x = pv.x * 0.6 + (mx / pdt) * 0.4
        pv.y = pv.y * 0.6 + (my / pdt) * 0.4
        pv.t = now
      }
      this.view.tx = this.view.x
      this.view.ty = this.view.y
      this.needsRender = true
    } else if (d.kind === 'note') {
      const n = this.notes.get(d.noteId!)
      if (!n || !d.moved) return
      const p = this.localPoint(e.clientX, e.clientY, n.pose.z)
      n.freePose.x = p.wx + d.grabDX!
      n.freePose.y = p.wy + d.grabDY!
      // swing with velocity
      const unitVel = (d.vx / this.h) * 2
      n.freePose.rot = n.freePose.rot * 0.98 + clamp(unitVel * -0.02, -0.18, 0.18) * 0.02
      n.pose.x = n.freePose.x
      n.pose.y = n.freePose.y
      n.pose.z = this.freeZ(n.pose.x, n.pose.y, n.zOrder)
      n.pose.rot += (n.freePose.rot + clamp(-unitVel * 0.035, -0.2, 0.2) - n.pose.rot) * 0.25
      n.dirty = true
      this.needsRender = true
    } else if (d.kind === 'page' && b) {
      const p = this.localPoint(e.clientX, e.clientY, 0.8)
      b.moveDrag(p.bx, p.by)
      this.needsRender = true
    } else if (d.kind === 'cover' && b) {
      const p = this.localPoint(e.clientX, e.clientY, 0.8)
      if (d.moved) b.moveCoverDrag(p.bx)
      this.needsRender = true
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    if (this.phone) { this.phoneGestures.up(e); return }
    this.pointers.delete(e.pointerId)
    const d = this.drag
    if (!d) return
    if (d.kind === 'pinch') {
      if (this.pointers.size < 2) {
        this.pinch = null
        this.drag = null
      }
      return
    }
    if (e.pointerId !== d.id) return
    this.finishDrag(e.clientX, e.clientY, e)
  }

  /**
   * End the active drag (pan / note / page / cover) the way a pointer-up would. Also used when the up event never
   * arrives (window blur, context menu, a second press, lost capture) so no held leaf or held cover is left behind.
   */
  private finishDrag(x: number, y: number, e?: PointerEvent) {
    const d = this.drag
    if (!d || d.kind === 'pinch') return
    this.pointers.delete(d.id)
    this.drag = null
    this.canvas.style.cursor = ''
    const b = this.book
    if (d.kind === 'tilt') {
      this.tiltBlockUntil = performance.now() + 500
      if (d.moved) {
        if (performance.now() - d.lastT < 90) {
          const vel = clamp(-d.vy * TILT_PER_PX, -2.4, 2.4)
          this.tiltTarget = clamp(this.tiltTarget + vel * 0.12, TILT_MIN, TILT_MAX)
        }
        this.tiltGlide = true
        this.hooks.onTilt(this.tiltTarget, true, true)
      }
      this.needsRender = true
      return
    }
    if (d.kind === 'pan') {
      if (d.moved && performance.now() - d.lastT < 90) {
        const cap = this.dist * 1.6
        const sp = Math.hypot(this.panVel.x, this.panVel.y)
        const k = sp > cap ? cap / sp : 1
        this.view.vx = this.panVel.x * k
        this.view.vy = this.panVel.y * k
      }
      if (!d.moved && e?.type === 'pointerup' && e.button === 0) {
        const start = this.pickImage(d.startX, d.startY)
        const end = this.pickImage(x, y)
        if (start && end?.path === start.path && document.elementFromPoint(x, y) === this.canvas) {
          this.hooks.onImageClick?.(end.path, this.loaded?.maps?.get(end.path) ?? null)
        } else this.onDeskClick(e)
      }
    } else if (d.kind === 'note-tab') {
      if (!d.moved && e?.type === 'pointerup' && this.pickNote(x, y)?.id === d.noteId) {
        const a = this.annotations.find((a) => a.id === d.noteId)
        if (a) this.revealLocator(a.locator)
      }
    } else if (d.kind === 'note') {
      const n = this.notes.get(d.noteId!)
      if (n) {
        n.held = false
        n.liftTarget = 0
        n.dirty = true
        if (d.moved) {
          n.freePose.rot = this.noteRestRotation(n.pose.x, n.pose.y, n.pose.z)
          // The resting angle follows the camera, so only persist the placement and neutral rotation.
          this.hooks.onNoteMoved(n.id, n.freePose.x, n.freePose.y, 0)
        } else if (!d.noteHandle && e?.type === 'pointerup') {
          this.hooks.onNoteClick(n.id, this.noteScreenRect(n.id) ?? new DOMRect(x, y, 1, 1))
        }
      }
    } else if (d.kind === 'page' && b) {
      const fresh = performance.now() - d.lastT < 90
      const travelled = Math.hypot(x - d.startX, y - d.startY)
      const click = e?.type === 'pointerup' && e.button === 0 && !d.moved && travelled <= DRAG_START_PX
      b.endDrag(fresh ? (d.vx / this.h) * 9 : 0, d.moved && travelled > 9, click ? 'quick' : 'natural')
    } else if (d.kind === 'cover' && b) {
      b.endCoverDrag((d.vx / this.h) * 9, d.moved)
      this.hooks.onOpenChange(b.psiTarget > Math.PI / 2)
      if (b.psiTarget > Math.PI / 2) {
        this.flyNotesOut()
        this.frameBook(true, true)
      } else {
        this.flyNotesIn()
        this.frameBook(true, false)
      }
    }
    this.needsRender = true
  }

  /** the pointer vanished without an up event (alt-tab, context menu, focus stolen): drop whatever is held */
  private onDragInterrupted = () => {
    this.phoneGestures.cancel(true)
    this.cancelKeyTurns()
    this.mouseDown = false
    this.nativeGesture = null
    const d = this.drag
    if (d && d.kind !== 'pinch') this.finishDrag(d.lastX, d.lastY)
    else if (d) {
      this.pinch = null
      this.drag = null
    }
    this.pointers.clear()
  }

  private onLostCapture = (e: PointerEvent) => {
    const d = this.drag
    if (d && d.kind !== 'pinch' && e.pointerId === d.id) this.finishDrag(e.clientX, e.clientY)
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.onDragInterrupted()
    else this.onViewportResize()
  }

  private onDeskClick(e: PointerEvent) {
    // click on a mark in the text layer is handled below; plain desk click clears selection
    this.clearSelection()
    this.hooks.onSelection(null)
    if (!this.editingNoteId || !this.book || e.type !== 'pointerup' || e.button !== 0) return
    // Pointer capture can retarget a release over UI to the canvas; check the actual element below it.
    if (document.elementFromPoint(e.clientX, e.clientY) !== this.canvas || this.pickNote(e.clientX, e.clientY)) return
    // pickNote set the pointer ray. Test the visible book geometry so paper margins are not "blank desk".
    const meshes: THREE.Mesh[] = []
    this.book.group.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh)) return
      // Deforming pages skip frustum culling, but raycasting still needs their current bounds.
      if (!object.frustumCulled) object.geometry.computeBoundingSphere()
      meshes.push(object)
    })
    if (!this.raycaster.intersectObjects(meshes, false).length) this.hooks.onBlankDeskClick()
  }

  private clearPageHint() {
    this.flutter = null
    this.book?.setPeel(0, 1, 0.5)
    this.canvas.style.cursor = ''
    this.needsRender = true
  }

  private hover(e: PointerEvent) {
    if (this.interactionSuspended) return
    const b = this.book
    if (!b) return
    // Native text selection has no scene drag, but must not activate page-edge hover effects.
    if (e.buttons !== 0) {
      this.clearPageHint()
      return
    }
    if (e.target !== this.canvas) {
      if (b.peelAmount && !this.flutter) b.setPeel(0, 1, 0.5)
      return
    }
    const note = this.pickNote(e.clientX, e.clientY)
    if (note) {
      this.clearPageHint()
      this.canvas.style.cursor = note.state === 'tab' ? 'pointer' : 'grab'
      return
    }
    if (this.pickImage(e.clientX, e.clientY)) {
      this.clearPageHint()
      this.canvas.style.cursor = 'zoom-in'
      return
    }
    const p = this.localPoint(e.clientX, e.clientY)
    const zone = b.zoneAt(p.bx, p.by)
    if (zone?.zone === 'cover') {
      this.canvas.style.cursor = 'pointer'
      return
    }
    if (zone?.zone === 'page') {
      const turnable = zone.side === 1 ? b.turned < b.N : b.settledTurned > 0
      if (turnable && !b.busy && this.inGrabZone(zone.u, zone.v)) {
        this.flutter = null
        this.canvas.style.cursor = 'grab'
        b.setPeel(1, zone.side, zone.v)
        this.needsRender = true
        return
      }
    }
    this.canvas.style.cursor = ''
    if (b.peelAmount && !this.flutter) {
      b.setPeel(0, 1, 0.5)
      this.needsRender = true
    }
  }

  /** a short, gentle lift of the right-hand page corner that tells new readers pages can be turned */
  flutterCorner() {
    if (this.phone) return false
    const b = this.book
    if (!b || !b.fullyOpen || b.busy || b.turned >= b.N || this.mouseDown || this.drag) return false
    this.flutter = { t: 0 }
    return true
  }

  /** screen position of a point on a page, for anchoring UI to the book */
  pagePoint(side: 1 | -1, u: number, v: number) {
    const b = this.book
    if (!b) return null
    const x = b.group.position.x + side * u * b.W
    return this.project(x, (v - 0.5) * b.H, b.stackTop(side))
  }

  private setZoomAt(z: number, cx: number, cy: number, immediate = false) {
    const r = this.el.getBoundingClientRect()
    const px = cx - r.left
    const py = cy - r.top
    z = clamp(z, 0.12, 7)
    this.view.tzoom = z
    this.view.fx = px
    this.view.fy = py
    this.view.focus = true
    if (immediate) {
      const before = this.unproject(px, py, 0)
      this.view.zoom = z
      const after = this.unproject(px, py, 0)
      this.view.x += before.x - after.x
      this.view.y += before.y - after.y
      this.view.tx = this.view.x
      this.view.ty = this.view.y
    }
    this.needsRender = true
  }

  private onWheel = (e: WheelEvent) => {
    if (this.phone) return
    if (this.interactionSuspended) return
    if (!this.book || this.isZoomUiTarget(e.target)) return
    if (e.cancelable) e.preventDefault()
    const d = this.drag
    if (d && d.kind !== 'pan') return
    // Some WebKit versions emit both streams for one pinch. The gesture scale owns it.
    if (this.nativeGesture) return
    const intent = readerWheelIntent(e, this.el)
    if (intent.kind === 'zoom') {
      if (intent.factor !== 1) this.setZoomAt(this.view.tzoom * intent.factor, e.clientX, e.clientY)
    } else if (!d && (intent.x || intent.y)) {
      const cx = this.w / 2, cy = this.h / 2
      const a = this.unproject(cx, cy, 0)
      const b = this.unproject(cx + intent.x, cy + intent.y, 0)
      // Wheel deltas describe scrolling the viewport; content moves oppositely.
      // Accumulate the target so rapid events survive the camera's smoothing.
      this.view.focus = false
      this.view.vx = this.view.vy = 0
      this.view.tx += b.x - a.x
      this.view.ty += b.y - a.y
      this.needsRender = true
    }
  }

  private onGesture = (event: Event) => {
    if (this.phone) return
    if (this.interactionSuspended) return
    if (!this.book) return
    const e = event as WebKitGesture
    if (e.type === 'gesturestart') {
      if (this.isZoomUiTarget(e.target)) return
      const r = this.el.getBoundingClientRect()
      this.nativeGesture = {
        zoom: this.view.tzoom,
        x: e.clientX ?? r.left + r.width / 2,
        y: e.clientY ?? r.top + r.height / 2,
      }
    }
    const gesture = this.nativeGesture
    if (!gesture) return
    if (e.cancelable) e.preventDefault()
    if (e.type === 'gestureend') {
      this.nativeGesture = null
      return
    }
    if (e.type !== 'gesturechange' || !Number.isFinite(e.scale) || e.scale <= 0) return
    // Touch pointers already handle touchscreen pinches; do not apply that zoom twice.
    if (this.drag && this.drag.kind !== 'pan') return
    this.setZoomAt(gesture.zoom * e.scale, gesture.x, gesture.y)
  }

  private onZoomKey = (e: KeyboardEvent) => {
    if (this.interactionSuspended) return
    if (e.target instanceof Element && e.target.closest('[data-atlas-dock]')) return
    if (!this.book || e.defaultPrevented || !e.cancelable || e.isComposing || e.altKey || !(e.ctrlKey || e.metaKey)) return
    if (this.applyZoomKey(e.key)) e.preventDefault()
  }

  private applyZoomKey(key: string) {
    switch (key) {
      case '+':
      case '=':
        this.zoomBy(1.25)
        return true
      case '-':
      case '_':
        this.zoomBy(0.8)
        return true
      case '0':
        this.resetView()
        return true
      default:
        return false
    }
  }

  private onDblClick = (e: MouseEvent) => {
    if (this.phone) return
    if (this.interactionSuspended || this.isUiTarget(e.target) || this.pickNote(e.clientX, e.clientY) || this.pickImage(e.clientX, e.clientY)) return
    const b = this.book
    if (!b || !b.fullyOpen) return
    const p = this.localPoint(e.clientX, e.clientY)
    const zone = b.zoneAt(p.bx, p.by)
    if (zone?.zone !== 'page') return
    // Edge/corner clicks already belong to page turning. Their native dblclick
    // must not also focus a page and move/zoom the camera during the turn.
    if (this.inGrabZone(zone.u, zone.v)) return
    const zoomed = this.view.tzoom > 1.5
    if (zoomed) this.focusPage(0)
    else this.focusPage(zone.side)
  }

  private cancelKeyTurns = () => { this.keyTurns = [] }

  private onPageFocus = (e: FocusEvent) => {
    if (!canPageFrom(e.target, 'ArrowRight')) this.cancelKeyTurns()
  }

  private onPageKeyUp = (e: KeyboardEvent) => {
    // Holding a key must not build up more turns after the user releases it.
    this.keyTurns = this.keyTurns.filter(turn => !turn.repeat || turn.key !== e.key)
  }

  private drainKeyTurns() {
    if (!this.keyTurns.length) return
    if (this.interactionSuspended || this.mouseDown || this.drag ||
        !canPageFrom(document.activeElement, this.keyTurns[0].key)) {
      this.cancelKeyTurns()
      return
    }
    const b = this.book
    if (!b) return
    const turn = this.keyTurns[0]
    // Explicit same-direction presses may join a safe flight immediately. Let the
    // book reject only conflicting directions, held sheets or the flight limit.
    // Auto-repeat stays paced at one flight, with no backlog after key release.
    if (turn.repeat && b.busy) return
    if (this.performTurn(turn.dir, 1, true)) this.keyTurns.shift()
  }

    private judouTarget(): { locator: Locator; keepCaret: boolean } | null {
        const sel = this.text?.readSelection()
        if (sel) return {locator: sel.locator, keepCaret: false}
        const cross = this.crossSelection?.locator
        if (cross) return {locator: cross, keepCaret: false}
        const caret = this.text?.readCaret()
        if (!caret) return null
        // Chapter start has no character before the caret; an empty range still lets the store remove
        // a mark on the first character, and it never looks past it for a neighbour.
        return {
            locator: {chapter: caret.chapter, start: Math.max(0, caret.offset - 1), end: caret.offset},
            keepCaret: true
        }
    }

  private onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || this.interactionSuspended || e.metaKey || e.ctrlKey || e.altKey) return
    const dir = pageKeyDirection(e.key, e.shiftKey)
    if (dir) {
      if (!canPageFrom(e.target, e.key) || this.mouseDown || this.drag) return
      e.preventDefault()
      // Discrete presses retain order across animations, including direction changes.
      // Only one auto-repeat may wait behind the current turn.
      if (!e.repeat || !this.keyTurns.some(turn => turn.repeat)) {
        if (this.keyTurns.length < 12) this.keyTurns.push({ dir, key: e.key, repeat: e.repeat })
      }
      this.drainKeyTurns()
      return
    }
    if (this.isUiTarget(e.target) || !canPageFrom(e.target, e.key)) return
      if (e.key === '/' && !e.repeat) {
          const target = this.judouTarget()
          if (!target) return
          e.preventDefault()
          this.hooks.onJudou?.(target.locator, target.keepCaret)
          return
      }
    if (this.applyZoomKey(e.key)) {
      e.preventDefault()
      return
    }
    switch (e.key) {
      case 'Home':
        this.goToLeaf(0)
        break
      case 'End':
        this.goToLeaf(this.book?.N ?? 0)
        break
      case 't':
      case 'T':
        this.cycleTilt()
        break
    }
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.interactionSuspended) return
    if (this.isTiltPress(e) && this.isDeskTarget(e.target)) {
      e.preventDefault()
      return
    }
    this.mouseDown = true
    if (e.button === 0 && e.target instanceof HTMLElement && e.target.closest('.text-layer')) {
      this.clearPageHint()
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    if (this.interactionSuspended) return
    this.mouseDown = false
    if (this.phone) return
    if (this.crossSelection?.ownsSelection) return
    this.checkSelection()
    // A word box fills the line, including the cream gap between highlight bars.
    // Only a click on the painted mark reopens the toolbar; the rest of the page dismisses it.
    if (this.text && e.button === 0) {
      const sel = window.getSelection()
      if (sel && sel.isCollapsed && (e.target as HTMLElement)?.closest?.('.text-layer')) {
        const mark = this.text.markAt(e.clientX, e.clientY, this.annotations, e.target)
        if (mark) this.hooks.onMarkClick(mark.id, new DOMRect(e.clientX - 2, e.clientY - 10, 4, 14))
        else this.hooks.onSelection(null)
      }
    }
  }

  private onSelectionChange = () => {
    if (this.interactionSuspended || this.crossSelection?.ownsSelection) return
    const sel = this.text?.readSelection()
    if (sel) {
      this.nativeSelectionShown = true
      this.text?.showPseudoSelection(sel.locator)
    } else if (this.nativeSelectionShown) {
      this.nativeSelectionShown = false
      this.text?.showPseudoSelection(null)
    }
    window.clearTimeout(this.selTimer)
    this.selTimer = window.setTimeout(() => {
      if (!this.mouseDown) this.checkSelection()
    }, 140)
  }

  private checkSelection() {
    if (this.interactionSuspended || this.crossSelection?.ownsSelection) return
    if (!this.text) return
    const sel = this.text.readSelection()
    if (sel) {
      this.nativeSelectionShown = true
      this.text.showPseudoSelection(sel.locator)
      this.hooks.onSelection(sel)
    }
    else if (window.getSelection()?.isCollapsed) {
      // keep pseudo selection alive; the UI decides when to dismiss
    }
  }

  clearSelection() {
    this.crossSelection?.reset()
    this.cancelReveal()
    this.nativeSelectionShown = false
    this.text?.clearNativeSelection()
    this.text?.showPseudoSelection(null)
  }

  showPseudoSelection(loc: Locator | null) {
    this.cancelReveal()
    this.nativeSelectionShown = false
    this.text?.showPseudoSelection(loc)
  }

  private cancelReveal() {
    this.pendingReveal = null
    window.clearTimeout(this.revealTimer)
    this.revealTimer = 0
  }

  /** Pulse the original passage once the destination spread is ready. */
  revealLocator(loc: Locator) {
    const pag = this.loaded?.pag
    if (!pag) return
    const pageIdx = pag.pageForOffset(loc.chapter, loc.start)
    this.clearSelection()
    this.goToLeaf(this.pageToLeafTurned(pageIdx))
    this.pendingReveal = loc
    this.needsRender = true
  }

  /** deterministic stepping for tests / screenshots */
  advance(seconds: number, step = 1 / 60) {
    this.paused = true
    const n = Math.round(seconds / step)
    for (let i = 0; i < n; i++) this.stepOnce(step)
    this.renderNow()
  }

  /** render and grab the WebGL canvas synchronously (tests / thumbnails) */
  snap(): string {
    this.renderNow()
    return this.canvas.toDataURL('image/png')
  }

  renderNow() {
    this.updateCamera()
    this.book?.setLightDir(this.viewLightDir())
    this.syncTextLayer()
    this.syncNoteOverlays()
    this.renderer.render(this.scene, this.camera)
    this.needsRender = false
  }

  /* -------------------------------- loop -------------------------------- */

  private loop = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    if (this.interactionSuspended) { this.last = now; return }
    const dt = this.paused ? 0 : Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    const active = this.stepOnce(dt) || this.needsRender
    if (active) {
      this.updateCamera()
      this.book?.setLightDir(this.viewLightDir())
      this.syncTextLayer()
      this.syncNoteOverlays()
      this.renderer.render(this.scene, this.camera)
      this.needsRender = false
      this.fpsFrames++
    }
    this.fpsT += dt
    if (this.fpsT >= 1) {
      this.fps = this.fpsFrames / this.fpsT
      this.fpsFrames = 0
      this.fpsT = 0
    }
  }

  private stepOnce(dt: number): boolean {
    const b = this.book
    let active = this.needsRender
    // camera inertia + smoothing
    const v = this.view
    if (Math.abs(v.vx) > 0.001 || Math.abs(v.vy) > 0.001) {
      v.x += v.vx * dt
      v.y += v.vy * dt
      v.tx = v.x
      v.ty = v.y
      const damp = Math.exp(-dt * 3.4)
      v.vx *= damp
      v.vy *= damp
      active = true
    }
    if (Math.abs(v.zoom - v.tzoom) > 0.0004) {
      const k = 1 - Math.exp(-dt * 11)
      if (v.focus) {
        const before = this.unproject(v.fx, v.fy, 0)
        v.zoom += (v.tzoom - v.zoom) * k
        const after = this.unproject(v.fx, v.fy, 0)
        v.x += before.x - after.x
        v.y += before.y - after.y
        v.tx = v.x
        v.ty = v.y
      } else {
        v.zoom += (v.tzoom - v.zoom) * k
        v.x += (v.tx - v.x) * k
        v.y += (v.ty - v.y) * k
      }
      this.hooks.onZoom(v.zoom)
      active = true
    } else if (!v.focus && (Math.abs(v.x - v.tx) > 0.001 || Math.abs(v.y - v.ty) > 0.001)) {
      const k = 1 - Math.exp(-dt * 9)
      v.x += (v.tx - v.x) * k
      v.y += (v.ty - v.y) * k
      active = true
    }

    if (this.flutter) {
      const f = this.flutter
      f.t += dt
      const dur = 2.7
      if (!b || !b.fullyOpen || b.busy || this.drag || f.t > dur) {
        this.flutter = null
        b?.setPeel(0, 1, 0.5)
      } else {
        const k = f.t / dur
        const env = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.6
        const amp = env * (0.5 - 0.5 * Math.cos(f.t * 2 * Math.PI * 1.15)) * 0.9
        b.setPeel(amp, 1, 0.25)
      }
      active = true
    }

    if (Math.abs(this.tilt - this.tiltTarget) > 0.0005) {
      const held = this.drag?.kind === 'tilt'
      this.tilt += (this.tiltTarget - this.tilt) * (1 - Math.exp(-dt * (held ? 13 : 6.5)))
      if (Math.abs(this.tilt - this.tiltTarget) <= 0.0005) this.tilt = this.tiltTarget
      active = true
      const settled = this.tilt === this.tiltTarget && !held
      if (this.tilt !== this.tiltReported || (settled && this.tiltGlide)) {
        this.tiltReported = this.tilt
        this.hooks.onTilt(this.tilt, settled && this.tiltGlide, held)
      }
      if (settled) this.tiltGlide = false
    }

    if (b) {
      // safety net: a held leaf or cover with no drag behind it (lost pointer-up) must not stay held
      const dk = this.drag?.kind
      if (b.hasHeldLeaf && dk !== 'page' && !this.phoneGestures.turning) b.endDrag(0, false)
      if (b.coverHeld && dk !== 'cover') {
        b.abortCoverDrag()
        this.hooks.onOpenChange(b.psiTarget > Math.PI / 2)
      }
      const wasMoving = !b.isStatic
      b.update(dt)
      this.drainKeyTurns()
      // Render the settling frame too: links/text hidden during a turn must become interactive again.
      if (wasMoving || !b.isStatic) active = true
      // notes
      const dirtyAll = !b.isStatic
      for (const n of this.notes.values()) {
        if (dirtyAll && n.state === 'free' && !n.held) {
          n.pose.z = this.freeZ(n.pose.x, n.pose.y, n.zOrder)
          n.dirty = true
        }
        if (n.state === 'free' && !n.held && (active || dirtyAll || n.dirty)) {
          n.freePose.rot = this.noteRestRotation(n.pose.x, n.pose.y, n.pose.z)
        }
        if (n.animating) {
          n.update(dt)
          active = true
        }
      }
    }

    return active
  }

  private updateCamera() {
    if (this.phone && this.book) {
      const b = this.book
      const distance = Math.max(b.H / 2, b.W / this.camera.aspect / 2) / Math.tan(FOV * Math.PI / 360) + b.stackTop(1) + .006
      updateReaderCamera(this.camera, b.W / 2, 0, distance, 0)
      return
    }
    const D = this.dist
    const tilt = this.tilt
    const sig = `${this.view.x.toFixed(5)}|${this.view.y.toFixed(5)}|${D.toFixed(5)}|${tilt}|${this.w}|${this.h}`
    if (sig === this.camSig) return
    this.camSig = sig
    updateReaderCamera(this.camera, this.view.x, this.view.y, D, tilt)
    const s = D * 9 + 140
    this.desk.mesh.scale.set(s, s, 1)
    this.desk.mesh.position.set(this.view.x, this.view.y, 0)
  }

  private syncNoteOverlays() {
    const b = this.book, pag = this.loaded?.pag, layer = this.noteLinks, handleLayer = this.noteHandles
    if (!layer || !handleLayer) return
    if (!b?.fullyOpen || b.busy || !pag || this.interactionSuspended) { layer.update([]); handleLayer.update([]); return }
    const links: NoteLink[] = []
    const handles: NoteHandle[] = []
    const cfg = pag.config
    const point = new THREE.Vector3()
    const toScreen = () => point.z < -1 || point.z > 1 ? { x: NaN, y: NaN } : { x: (point.x + 1) * this.w / 2, y: (1 - point.y) * this.h / 2 }
    const onScreen = (quad: Point[]) => quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
      Math.max(...quad.map((p) => p.x)) >= 0 && Math.min(...quad.map((p) => p.x)) <= this.w &&
      Math.max(...quad.map((p) => p.y)) >= 0 && Math.min(...quad.map((p) => p.y)) <= this.h
    for (const a of this.annotations) {
      const n = this.notes.get(a.id)
      if (!a.note || !n || n.state !== 'free' || !n.mesh.visible || a.id === this.editingNoteId) continue
      // Use the curled paper's real corners, not its axis-aligned screen bounds.
      n.mesh.updateWorldMatrix(true, false)
      const geo = n.mesh.geometry as THREE.PlaneGeometry
      const pos = geo.attributes.position, edge = geo.parameters.widthSegments
      const note = [0, edge, pos.count - 1, pos.count - 1 - edge].map((i) => {
        point.fromBufferAttribute(pos, i).applyMatrix4(n.mesh.matrixWorld).project(this.camera)
        return toScreen()
      })
      if (!onScreen(note)) continue
      const [tl] = note
      // Use the local mesh tangents near the corner so the handle follows perspective and curl.
      const projectVertex = (index: number) => {
        point.fromBufferAttribute(pos, index).applyMatrix4(n.mesh.matrixWorld).project(this.camera)
        return toScreen()
      }
      const nearRight = projectVertex(1), nearBottom = projectVertex(edge + 1)
      const ax = (nearRight.x - tl.x) * edge / 100, ay = (nearRight.y - tl.y) * edge / 100
      const bx = (nearBottom.x - tl.x) * geo.parameters.heightSegments / 100, by = (nearBottom.y - tl.y) * geo.parameters.heightSegments / 100
      handles.push({
        id: n.id, x: tl.x + ax * 3 + bx * 1, y: tl.y + ay * 3 + by * 1,
        ax, ay, bx, by, order: n.zOrder,
      })
      const passages: Point[][] = []
      for (const side of [-1, 1] as const) {
        const page = pag.pages[b.settledTurned * 2 + (side === -1 ? -1 : 0)]
        if (!page || page.special || page.chapter !== a.locator.chapter || a.locator.end <= page.start || a.locator.start >= page.end) continue
        const surface = b.pageSurface(side)
        if (!surface) continue
        surface.mesh.updateWorldMatrix(true, false)
        const origin = contentOrigin(page, cfg)
        for (const r of rangeRects(page, a.locator.start, a.locator.end)) {
          const x0 = origin.x + r.x0, x1 = origin.x + r.x1
          const y0 = origin.y + r.line.y + r.line.baseline - cfg.fontSize * 0.84
          const y1 = y0 + cfg.fontSize * 1.12
          const quad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
            surface.pointAt(side === 1 ? x / cfg.pageW : 1 - x / cfg.pageW, 1 - y / cfg.pageH, point)
              .applyMatrix4(surface.mesh.matrixWorld).project(this.camera)
            return toScreen()
          })
          if (onScreen(quad)) passages.push(quad)
        }
      }
      const line = noteConnector(note, passages)
      if (line) links.push({ id: a.id, ...line })
    }
    layer.update(links)
    handleLayer.update(handles)
  }

  private syncTextLayer() {
    const b = this.book
    const tl = this.text
    const pag = this.loaded?.pag
    if (!b || !tl || !pag) return
    const live = b.fullyOpen && !b.busy && !this.drag?.moved && !this.phoneGestures.turning
    // Prepare the destination's word boxes while hidden, so the settling frame
    // can restore hit-testing and selection without first rebuilding the whole DOM.
    const left = this.phone ? -1 : b.turned * 2 - 1
    const right = this.phone ? b.turned : b.turned * 2
    const sig = `${left}|${right}`
    if (sig !== this.lastTextSig) {
      tl.setPage(0, pag.pages[left] ?? null)
      tl.setPage(1, pag.pages[right] ?? null)
      this.lastTextSig = sig
    }
    tl.setVisible(live)
    tl.setInteractive(live && !this.interactionSuspended)
    if (!live || this.interactionSuspended) { this.imageLinks?.update([]); return }
    const cfg = pag.config
    const point = new THREE.Vector3()
    const links: ImageLink[] = []
    for (const slot of [0, 1] as const) {
      const side = slot === 0 ? -1 : 1
      const surface = b.pageSurface(side)
      surface?.mesh.updateWorldMatrix(true, false)
      tl.setProjection(slot, surface ? (x, y) => {
        const u = side === 1 ? x / cfg.pageW : 1 - x / cfg.pageW
        surface.pointAt(u, 1 - y / cfg.pageH, point).applyMatrix4(surface.mesh.matrixWorld).project(this.camera)
        return { x: (point.x + 1) * this.w / 2, y: (1 - point.y) * this.h / 2 }
      } : null)
      const page = pag.pages[slot === 0 ? left : right]
      if (surface && page && !this.drag) for (const [i, image] of page.images.entries()) {
        if (!isPageImage(image)) continue
        const origin = contentOrigin(page, cfg)
        const x = origin.x + image.x + image.w, y = origin.y + image.y + image.h
        surface.pointAt(side === 1 ? x / cfg.pageW : 1 - x / cfg.pageW, 1 - y / cfg.pageH, point).applyMatrix4(surface.mesh.matrixWorld).project(this.camera)
        links.push({ key: `${page.index}:${i}`, path: image.path, alt: image.alt, x: (point.x + 1) * this.w / 2, y: (1 - point.y) * this.h / 2 })
      }
    }
    this.imageLinks?.update(links)
    this.crossSelection?.sync()
    if (this.pendingReveal) {
      const loc = this.pendingReveal
      const targetPage = pag.pageForOffset(loc.chapter, loc.start)
      if (targetPage === left || targetPage === right) {
        this.pendingReveal = null
        tl.showPseudoSelection(loc)
        this.revealTimer = window.setTimeout(() => {
          tl.showPseudoSelection(null)
          this.revealTimer = 0
        }, 1800)
      }
    }
  }
}
