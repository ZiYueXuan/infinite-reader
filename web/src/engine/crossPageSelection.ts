import { t } from '../i18n/runtime.ts'
import type { Locator } from '../book/annotations'
import type { Paginated } from '../book/layout'
import type { SelectionInfo, TextLayer } from './textLayer'

interface Host {
  phone?: boolean
  ready(): boolean
  pagination(): Paginated
  turn(): void
  text(locator: Locator): string
  select(selection: SelectionInfo | null): void
}

/** Stable source selection across turns, with native mouse selection or a phone long-press anchor. */
export class CrossPageSelection {
  private abort = new AbortController()
  private pressed = false
  private pointer = -1
  private point = { x: 0, y: 0 }
  private native: SelectionInfo | null = null
  private range: Locator | null = null
  private touchAnchor: Locator | null = null
  private phase: 'native' | 'turning' | 'waiting' | 'extending' | 'finished' = 'native'
  private timer = 0
  private painted = ''
  private movedDuringTurn = false
  private hint = document.createElement('div')
  private layer: TextLayer
  private host: Host

  constructor(layer: TextLayer, host: Host) {
    this.layer = layer
    this.host = host
    this.hint.className = 'selection-turn-hint'
    this.hint.setAttribute('role', 'status')
    this.hint.hidden = true
    layer.root.parentElement!.appendChild(this.hint)
    const options = { capture: true, signal: this.abort.signal }
    window.addEventListener('pointerdown', this.down, options)
    window.addEventListener('pointermove', this.move, options)
    window.addEventListener('pointerup', this.up, options)
    window.addEventListener('pointercancel', this.cancelPointer, options)
    window.addEventListener('blur', this.interrupt, options)
    window.addEventListener('keydown', this.key, options)
    document.addEventListener('selectionchange', this.selectionChange, options)
    document.addEventListener('copy', this.copy, options)
    document.addEventListener('visibilitychange', this.visibility, options)
    window.addEventListener('mousemove', this.mouseMove, options)
  }

  get ownsSelection() { return this.range !== null }

    /** The settled source range, for UI that acts on the selection after the native one was cleared. */
    get locator() {
        return this.pressed ? null : this.range
    }

  reset() {
    this.stopTimer()
    this.pressed = false
    this.pointer = -1
    this.native = null
    this.range = null
    this.touchAnchor = null
    this.phase = 'native'
    this.painted = ''
    this.movedDuringTurn = false
    this.layer.root.classList.remove('cross-page-selecting')
    this.layer.showPseudoSelection(null)
    this.hint.hidden = true
  }

  dispose() { this.reset(); this.abort.abort(); this.hint.remove() }

  startTouch(locator: Locator, x: number, y: number) {
    this.reset()
    this.pressed = true
    this.point = { x, y }
    this.touchAnchor = { ...locator }
    this.range = { ...locator }
    this.phase = 'extending'
    this.layer.clearNativeSelection()
    this.host.select(null)
    this.paint()
  }

  moveTouch(x: number, y: number) {
    if (!this.pressed || !this.touchAnchor) return
    if (this.phase === 'turning' && Math.hypot(x - this.point.x, y - this.point.y) > 1) this.movedDuringTurn = true
    this.point = { x, y }
    if (!this.host.ready() || this.phase === 'turning') return
    if (this.extendAtPointer()) return
    this.considerTurn()
  }

  endTouch(cancel: boolean) {
    if (!this.touchAnchor || !this.pressed) return
    if (cancel) { this.reset(); this.host.select(null) }
    else this.finish()
  }

  private down = (event: PointerEvent) => {
    // PhoneGestures owns the touch lifecycle, including release and multi-touch cancellation.
    if (this.host.phone) return
    if (event.button !== 0) return
    const el = event.target instanceof Element ? event.target : null
    if (el?.closest('[data-ui]')) return
    this.reset()
    if (event.pointerType !== 'mouse' || !this.host.ready() || !el?.closest('.text-page .w') || !this.layer.root.contains(el)) return
    this.host.select(null)
    this.pressed = true
    this.pointer = event.pointerId
    this.point = { x: event.clientX, y: event.clientY }
  }

  private selectionChange = () => {
    if (this.ownsSelection) {
      // DOM nodes are replaced during turns; native browser ranges must not overwrite the saved range.
      if (window.getSelection()?.rangeCount) this.layer.clearNativeSelection()
      return
    }
    if (!this.pressed) return
    const selection = this.layer.readSelection()
    if (selection) this.native = selection
    this.considerTurn()
  }

  private move = (event: PointerEvent) => {
    if (!this.pressed || event.pointerId !== this.pointer) return
    if (!(event.buttons & 1)) { this.finish(); return }
    if (this.phase === 'turning' && Math.hypot(event.clientX - this.point.x, event.clientY - this.point.y) > 1) this.movedDuringTurn = true
    this.point = { x: event.clientX, y: event.clientY }
    if (this.ownsSelection) {
      event.preventDefault()
      if (!this.host.ready() || this.phase === 'turning') return
      if (this.extendAtPointer()) return
      if (this.phase === 'waiting') return
    } else {
      const selection = this.layer.readSelection()
      if (selection) this.native = selection
    }
    this.considerTurn()
  }

  /** Returns true at a chapter boundary, where another turn must not be armed. */
  private extendAtPointer(): boolean {
    if (this.touchAnchor && this.phase === 'waiting' && this.inForwardCorner()) return false
    const caret = this.layer.caretAt(this.point.x, this.point.y)
    // The pointer stays at the old lower-right corner after a turn. Only re-entry into text resumes selection.
    if (caret && caret.chapter === this.range!.chapter) {
      this.phase = 'extending'
      if (this.touchAnchor) {
        this.range!.start = Math.min(this.touchAnchor.start, caret.offset)
        this.range!.end = Math.max(this.touchAnchor.end, caret.offset)
      } else this.range!.end = Math.max(this.range!.start + 1, caret.offset)
      this.hint.hidden = true
      this.paint()
    } else if (caret && caret.chapter > this.range!.chapter) {
      const last = this.host.pagination().pages.filter(page => page.chapter === this.range!.chapter && !page.special).at(-1)
      if (last) this.range!.end = last.end
      this.phase = 'extending'
      this.stopTimer()
      this.paint()
      this.showChapterEnd()
      return true
    }
    return false
  }

  private mouseMove = (event: MouseEvent) => {
    if (this.pressed && this.ownsSelection) event.preventDefault()
  }

  private inForwardCorner(edge = this.layer.forwardSelectionEdge()) {
    if (!edge) return false
    const { x, y } = this.point
    if (this.touchAnchor) {
      const bounds = this.layer.root.getBoundingClientRect()
      // A thumb can reach the page corner without hitting the final character or leaving the viewport.
      return x >= bounds.right - Math.min(96, bounds.width * .28) && x <= bounds.right &&
        y >= Math.max(bounds.top + bounds.height * .65, Math.min(edge.y - 16, bounds.bottom - 72)) && y <= bounds.bottom
    }
    return x >= edge.x + 8 && x <= edge.x + 150 && y >= edge.y + 6 && y <= edge.y + 180
  }

  private considerTurn() {
    if (!this.pressed || !this.host.ready() || this.phase === 'turning' || this.phase === 'waiting') return
    const loc = this.range ?? this.native?.locator, edge = this.layer.forwardSelectionEdge()
    if (!loc || !edge || loc.chapter !== edge.chapter || (!this.touchAnchor && loc.end < edge.start) || !this.inForwardCorner(edge)) {
      this.stopTimer()
      this.hint.hidden = true
      return
    }
    if (this.touchAnchor) {
      this.range = { ...this.touchAnchor, end: Math.max(this.touchAnchor.end, edge.end) }
      this.paint()
    }
    const next = this.host.pagination().pages[edge.page + 1]
    // Source locators currently belong to one chapter. Never silently include a different chapter.
    if (!next || next.special || next.chapter !== loc.chapter) {
      this.stopTimer()
      this.showChapterEnd()
      return
    }
    if (this.timer) return
    this.showHint(t("保持按住，即将翻页…"))
    this.timer = window.setTimeout(() => {
      this.timer = 0
      if (!this.pressed || !this.host.ready()) return
      this.range = { ...(this.range ?? loc), end: edge.end }
      this.phase = 'turning'
      this.movedDuringTurn = false
      this.layer.root.classList.add('cross-page-selecting')
      this.layer.clearNativeSelection()
      this.host.select(null)
      this.paint()
      this.showHint(this.host.phone ? t("翻页中，请保持按住") : t("翻页中，请保持按住鼠标"))
      this.host.turn()
    }, 500)
  }

  /** Called after the newly visible pages and their projections are ready. */
  sync() {
    if (!this.ownsSelection || !this.host.ready()) return
    if (this.phase === 'turning') {
      this.phase = 'waiting'
      if (!this.pressed) this.finish()
      else {
        this.showHint(this.host.phone ? t("移入新页正文继续选择 · 抬手完成") : t("移入新页正文继续选择 · 松开完成 · Esc 取消"))
        // Pointer moves while the text layer is hidden were recorded but could not
        // be hit-tested. Replay the latest position now, without requiring a new move.
        if (this.movedDuringTurn) this.extendAtPointer()
      }
      this.movedDuringTurn = false
    }
    this.paint()
  }

  private paint() {
    if (!this.range) return
    const key = `${this.layer.pageIn(0)?.index}|${this.layer.pageIn(1)?.index}|${this.range.start}|${this.range.end}`
    if (key === this.painted) return
    this.painted = key
    this.layer.showPseudoSelection(this.range)
  }

  private finish() {
    this.stopTimer()
    this.pressed = false
    if (!this.range) { this.hint.hidden = true; return }
    // Releasing during the animation commits only the last confirmed range, once the spread settles.
    if (this.phase === 'turning') return
    this.phase = 'finished'
    this.hint.hidden = true
    const x = Math.max(20, Math.min(window.innerWidth - 20, this.point.x))
    const y = Math.max(60, Math.min(window.innerHeight - 90, this.point.y))
    this.host.select({ locator: { ...this.range }, text: this.host.text(this.range), rect: new DOMRect(x, y, 1, 18),
      page: this.layer.pageIn(this.host.phone ? 1 : 0)?.index ?? 0 })
  }

  private up = (event: PointerEvent) => { if (this.pressed && event.button === 0 && event.pointerId === this.pointer) this.finish() }
  private cancelPointer = (event: PointerEvent) => { if (event.pointerId === this.pointer) { this.reset(); this.host.select(null) } }
  private interrupt = () => { if (this.pressed) { if (this.host.phone) this.endTouch(true); else this.finish() } }
  private visibility = () => { if (document.hidden) this.interrupt() }
  private key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (!this.pressed && !this.ownsSelection)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.reset()
    this.layer.clearNativeSelection()
    this.host.select(null)
  }
  private copy = (event: ClipboardEvent) => {
    if (!this.range || this.phase !== 'finished' || !event.clipboardData) return
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return
    event.clipboardData.setData('text/plain', this.host.text(this.range))
    event.preventDefault()
  }
  private stopTimer() { window.clearTimeout(this.timer); this.timer = 0 }
  private showChapterEnd() {
    this.showHint(this.host.phone ? t("已到章节末尾，请抬手完成选文") : t("已到章节末尾，请松开鼠标完成选文"))
  }
  private showHint(message: string) {
    this.hint.textContent = message
    this.hint.hidden = false
  }
}
