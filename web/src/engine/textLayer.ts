import { t } from '../i18n/runtime.ts'
import { measure, type LayoutConfig, type Page } from '../book/layout'
import { contentOrigin, markUnderPoint, rangeRects } from '../book/pageRender'
import type { Footnote } from '../book/types'
import type { Annotation, Locator } from '../book/annotations'
import { localInProjectedBox } from './projectedBox'

export interface SelectionInfo {
  locator: Locator
  text: string
  rect: DOMRect
  /** page side where the selection ends */
  page: number
}

/** A collapsed caret in the original text, which readSelection() deliberately ignores. */
export interface CaretInfo {
    chapter: number
    /** offset between two source characters */
    offset: number
    /** box of the character before the caret, for anchors */
    rect: DOMRect
}

type PageProjection = (x: number, y: number) => { x: number; y: number }
interface TextBox {
  el: HTMLElement
  x: number
  y: number
  w: number
  h: number
}

interface NoteBox extends TextBox {
  id: string
  key: string
  el: HTMLButtonElement
}

interface Slot {
  el: HTMLDivElement
  sel: HTMLDivElement
  page: Page | null
  words: TextBox[]
  highlights: TextBox[]
  notes: NoteBox[]
  footnotes: TextBox[]
  tags: TextBox[]
  project: PageProjection | null
}

/**
 * A transparent DOM text layer that lines up with the textured pages so that the browser's native
 * selection, caret and copy behaviour work on top of the WebGL book.
 */
export class TextLayer {
  readonly root: HTMLDivElement
  private slots: [Slot, Slot]
  private cfg: LayoutConfig
  visible = false
  private interactive = false
  private activeNoteKey: string | null = null
  private onNoteClick?: (id: string, rect: DOMRect) => void

  private onTagClick?: (tag: string, anchor: HTMLButtonElement) => void

  private onFootnoteClick?: (note: Footnote, anchor: HTMLButtonElement) => void

  constructor(parent: HTMLElement, cfg: LayoutConfig, onNoteClick?: (id: string, rect: DOMRect) => void, onFootnoteClick?: (note: Footnote, anchor: HTMLButtonElement) => void, onTagClick?: (tag: string, anchor: HTMLButtonElement) => void) {
    this.cfg = cfg
    this.onNoteClick = onNoteClick
    this.onFootnoteClick = onFootnoteClick
    this.onTagClick = onTagClick
    this.root = document.createElement('div')
    this.root.className = 'text-layer'
    const mk = (): Slot => {
      const el = document.createElement('div')
      el.className = 'text-page'
      el.style.width = cfg.pageW + 'px'
      el.style.height = cfg.pageH + 'px'
      const sel = document.createElement('div')
      sel.className = 'pseudo-sel'
      el.appendChild(sel)
      this.root.appendChild(el)
      return { el, sel, page: null, words: [], highlights: [], notes: [], footnotes: [], tags: [], project: null }
    }
    this.slots = [mk(), mk()]
    parent.appendChild(this.root)
    this.setVisible(false)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.root.style.opacity = v ? '1' : '0'
    this.root.style.pointerEvents = 'none'
    for (const s of this.slots) s.el.style.pointerEvents = v ? 'none' : 'none'
    this.root.classList.toggle('live', v)
    this.updateNoteInteractivity()
  }

  setPage(slot: 0 | 1, page: Page | null) {
    const s = this.slots[slot]
    if (s.page === page) return
    s.page = page
    // remove words
    for (const child of Array.from(s.el.children)) if (child !== s.sel) child.remove()
    s.sel.replaceChildren()
    s.words = []
    s.highlights = []
    s.notes = []
    s.footnotes = []
    s.tags = []
    if (!page || page.special) return
    const o = contentOrigin(page, this.cfg)
    const frag = document.createDocumentFragment()
    for (const line of page.lines) {
      for (let wi = 0; wi < line.words.length; wi++) {
        const w = line.words[wi]
        if (w.s < 0) continue
        const sp = document.createElement('span')
        const next = line.words[wi + 1]
        sp.className = 'w'
        sp.textContent = w.space ? w.text + ' ' : w.text
        // Include justification gaps in the hit box without painting one selection per glyph.
        const width = Math.max(measure(w.font, sp.textContent), next ? next.x - w.x : w.w)
        sp.style.width = width + 'px'
        sp.style.font = w.font
        sp.style.lineHeight = line.h + 'px'
        sp.style.height = line.h + 'px'
        sp.dataset.s = String(w.s)
        sp.dataset.e = String(w.e)
        sp.dataset.c = String(page.chapter)
        sp.dataset.p = String(page.index)
        sp.dataset.line = String(line.y)
        s.words.push({ el: sp, x: o.x + w.x, y: o.y + line.y, w: width, h: line.h })
        frag.appendChild(sp)
        if (w.footnote) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'footnote-hit'
          button.dataset.ui = ''
          button.dataset.footnoteId = w.footnote.id
          button.setAttribute('aria-label', t("阅读脚注"))
          button.setAttribute('aria-haspopup', 'dialog')
          button.title = t("阅读脚注")
          Object.assign(button.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', width: `${w.w}px`, height: `${line.h}px` })
          button.onpointerdown = button.onmousedown = (event) => event.stopPropagation()
          button.ondblclick = (event) => event.stopPropagation()
          button.onclick = (event) => {
            event.stopPropagation()
            if (this.visible && this.interactive) this.onFootnoteClick?.(w.footnote!, button)
          }
          s.footnotes.push({ el: button, x: o.x + w.x, y: o.y + line.y, w: w.w, h: line.h })
          frag.appendChild(button)
        }
      }
    }
    // The note itself is ink in the page texture. Empty buttons provide keyboard and
    // pointer access without ever mixing user notes into native original-text selection.
    for (const [i, note] of (page.notes ?? []).entries()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'inline-note-hit'
      button.dataset.ui = ''
      button.dataset.inlineNoteId = note.id
      const preview = note.lines.map((line) => line.words.map((word) => word.text + (word.space ? ' ' : '')).join('')).join(' ').slice(0, 160)
      button.setAttribute('aria-label', t("编辑笔记{0}", preview ? `：${preview}` : ''))
      button.title = t("编辑笔记")
      Object.assign(button.style, {
        position: 'absolute', left: '0', top: '0', transformOrigin: '0 0',
        width: `${note.w}px`, height: `${note.h}px`, padding: '0', margin: '0',
        border: '0', background: 'transparent', cursor: 'text', userSelect: 'none',
      })
      const key = `${page.index}:${i}`
      button.onclick = (event) => {
        event.stopPropagation()
        if (!this.visible || !this.interactive) return
        this.activeNoteKey = key
        this.onNoteClick?.(note.id, button.getBoundingClientRect())
      }
      button.onpointerdown = (event) => event.stopPropagation()
      button.onmousedown = (event) => event.stopPropagation()
      button.ondblclick = (event) => event.stopPropagation()
      s.notes.push({ id: note.id, key, el: button, x: o.x + note.x, y: o.y + note.y, w: note.w, h: note.h })
      frag.appendChild(button)
      // Link hit targets share the curved-page projection and never select source text.
      for (const line of note.lines) {
        const groups: (typeof line.words)[] = []
        for (const word of line.words) {
          const last = groups.at(-1)
          if (word.noteLink && last?.at(-1)?.noteLink === word.noteLink) last.push(word)
          else groups.push([word])
        }
        for (const words of groups) {
          const first = words[0], last = words.at(-1)!
          if (!first.noteLink) continue
          const width = last.x + last.w - first.x
          const target = document.createElement('button')
          target.type = 'button'
          target.className = 'inline-note-link-hit'
          target.dataset.ui = ''
          target.dataset.noteLink = first.noteLink
          target.setAttribute('aria-label', words.map(word => word.text + (word.space ? ' ' : '')).join(''))
          target.title = first.noteLink
          Object.assign(target.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', width: `${width}px`, height: `${line.h}px` })
          target.onpointerdown = target.onmousedown = target.ondblclick = event => event.stopPropagation()
          target.onclick = event => {
            event.stopPropagation()
            if (this.visible && this.interactive) window.open(first.noteLink, '_blank', 'noopener,noreferrer')
          }
          s.tags.push({ el: target, x: o.x + note.x + first.x, y: o.y + note.y + line.y, w: width, h: line.h })
          frag.appendChild(target)
        }
      }
      // Tag targets sit above the note editor target and follow the same curved-page projection.
      for (const line of note.lines) {
        const groups = new Map<string, typeof line.words>()
        for (const word of line.words) if (word.noteTag) {
          const words = groups.get(word.noteTag) ?? []
          words.push(word)
          groups.set(word.noteTag, words)
        }
        for (const [tag, words] of groups) {
          const first = words[0], last = words[words.length - 1]
          const width = last.x + last.w - first.x
          const target = document.createElement('button')
          target.type = 'button'
          target.className = 'inline-note-tag-hit'
          target.dataset.ui = ''
          target.dataset.noteTag = tag
          target.setAttribute('aria-label', t("查看本书中 #{0} 的全部笔记", tag))
          target.setAttribute('aria-haspopup', 'dialog')
          target.title = t("查看 #{0}", tag)
          Object.assign(target.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', width: `${width}px`, height: `${line.h}px` })
          target.onpointerdown = target.onmousedown = event => event.stopPropagation()
          target.ondblclick = event => event.stopPropagation()
          target.onclick = event => {
            event.stopPropagation()
            if (this.visible && this.interactive) this.onTagClick?.(tag, target)
          }
          s.tags.push({ el: target, x: o.x + note.x + first.x, y: o.y + note.y + line.y, w: width, h: line.h })
          frag.appendChild(target)
        }
      }
    }
    s.el.appendChild(frag)
    this.updateNoteInteractivity()
  }

  pageIn(slot: 0 | 1) {
    return this.slots[slot].page
  }

  /** Project each word onto the actual sheet instead of stretching a flat overlay over its gutter. */
  setProjection(slot: 0 | 1, project: PageProjection | null) {
    const s = this.slots[slot]
    s.project = project
    s.el.style.display = project ? '' : 'none'
    if (!project) return
    for (const box of [...s.words, ...s.notes, ...s.footnotes, ...s.tags]) {
      const { x, y, w, h } = box
      box.el.style.transform = quadToCss([project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)], w, h)
    }
    this.projectHighlights(s)
  }

  private projectHighlights(s: Slot) {
    const project = s.project
    if (!project) return
    for (const box of s.highlights) {
      // A single curved polygon per line avoids alpha seams between adjacent characters.
      const steps = Math.max(1, Math.ceil(box.w / 16))
      const top = Array.from({ length: steps + 1 }, (_, i) => project(box.x + box.w * i / steps, box.y))
      const bottom = Array.from({ length: steps + 1 }, (_, i) => project(box.x + box.w * (1 - i / steps), box.y + box.h))
      const points = [...top, ...bottom]
      const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
      const w = Math.max(...points.map(p => p.x)) - x, h = Math.max(...points.map(p => p.y)) - y
      Object.assign(box.el.style, {
        left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
        clipPath: `polygon(${points.map(p => `${p.x - x}px ${p.y - y}px`).join(',')})`,
      })
    }
  }

  /** enable text interaction (pointer-events on words) */
  setInteractive(on: boolean) {
    this.interactive = on
    this.root.classList.toggle('interactive', on)
    this.updateNoteInteractivity()
  }

  private updateNoteInteractivity() {
    const active = this.visible && this.interactive
    for (const slot of this.slots) for (const note of [...slot.notes, ...slot.footnotes, ...slot.tags]) {
      (note.el as HTMLButtonElement).disabled = !active
      note.el.tabIndex = active ? 0 : -1
      note.el.style.pointerEvents = active ? 'auto' : 'none'
    }
  }

  noteScreenRect(id: string): DOMRect | null {
    if (!this.visible) return null
    const boxes = this.slots.filter((slot) => slot.project).flatMap((slot) => slot.notes).filter((note) => note.id === id)
    const box = boxes.find((note) => note.key === this.activeNoteKey) ?? boxes[0]
    return box?.el.getBoundingClientRect() ?? null
  }

  private spanFor(container: Node, offset: number, start: boolean): { span: HTMLElement; local: number } | null {
    let el: Element | null = container.nodeType === 3 ? container.parentElement : (container as Element)
    if (!el) return null
    let span = el.closest('span.w') as HTMLElement | null
    if (span && this.root.contains(span)) {
      const len = span.textContent?.length ?? 0
      const local = container.nodeType === 3 ? offset : start ? 0 : len
      return { span, local }
    }
    if (el === this.root || el.classList.contains('text-page')) {
      const spans = Array.from(el.querySelectorAll('span.w')) as HTMLElement[]
      if (!spans.length) return null
      const kids = Array.from(el.children)
      const child = kids[offset] as HTMLElement | undefined
      if (child && child.classList.contains('w')) return { span: child, local: 0 }
      const prev = (start ? kids[offset] : kids[offset - 1]) as HTMLElement | undefined
      if (prev && prev.classList.contains('w')) return { span: prev, local: start ? 0 : prev.textContent!.length }
      const fallback = start ? spans[spans.length - 1] : spans[0]
      return { span: fallback, local: start ? fallback.textContent!.length : 0 }
    }
    el = null
    span = null
    return null
  }

  readSelection(): SelectionInfo | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
    const range = sel.getRangeAt(0)
    if (!this.root.contains(range.commonAncestorContainer)) return null
    const a = this.spanFor(range.startContainer, range.startOffset, true)
    const b = this.spanFor(range.endContainer, range.endOffset, false)
    if (!a || !b) return null
    const chapter = Number(a.span.dataset.c)
    const s0 = Number(a.span.dataset.s) + Math.min(a.local, Number(a.span.dataset.e) - Number(a.span.dataset.s))
    let e0: number
    if (Number(b.span.dataset.c) !== chapter) {
      const same = Array.from(this.root.querySelectorAll<HTMLElement>(`span.w[data-c="${chapter}"]`))
      e0 = Math.max(...same.map((x) => Number(x.dataset.e)))
    } else {
      e0 = Number(b.span.dataset.s) + Math.min(b.local, Number(b.span.dataset.e) - Number(b.span.dataset.s))
    }
    const start = Math.min(s0, e0)
    const end = Math.max(s0, e0)
    if (end - start < 1) return null
    const text = this.textInRange(range, a, b)
    if (!text) return null
    const rects = range.getClientRects()
    const rect = rects.length ? range.getBoundingClientRect() : range.getBoundingClientRect()
    return { locator: { chapter, start, end }, text, rect, page: Number(b.span.dataset.p) }
  }

    /**
     * The collapsed caret. `/` and the clause mark need the character a caret sits after, while
     * readSelection() returns null until the reader drags a range.
     */
    readCaret(): CaretInfo | null {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
        const range = sel.getRangeAt(0)
        if (!this.root.contains(range.startContainer)) return null
        const a = this.spanFor(range.startContainer, range.startOffset, false)
        if (!a) return null
        const start = Number(a.span.dataset.s), end = Number(a.span.dataset.e)
        if (end <= start) return null
        const local = Math.min(a.local, end - start)
        // The caret itself has no width; anchor on the character it follows.
        let rect = a.span.getBoundingClientRect()
        const node = a.span.firstChild
        if (node?.nodeType === 3 && local > 0) {
            const probe = document.createRange()
            probe.setStart(node, local - 1)
            probe.setEnd(node, local)
            const r = probe.getBoundingClientRect()
            if (r.width > 0 && r.height > 0) rect = r
        }
        return {chapter: Number(a.span.dataset.c), offset: start + local, rect}
    }

  /** Selected text rebuilt from the word spans, so ideographs never pick up stray spaces or line breaks. */
  private textInRange(range: Range, a: { span: HTMLElement; local: number }, b: { span: HTMLElement; local: number }) {
    const spans = Array.from(this.root.querySelectorAll<HTMLElement>('span.w')).filter((sp) => range.intersectsNode(sp))
    const cjk = /[\u2e80-\u9fff\uac00-\ud7ff\uf900-\ufaff\uff00-\uffef]/
    let out = ''
    let lastTop = ''
    for (const sp of spans) {
      let t = sp.textContent ?? ''
      if (sp === a.span && sp === b.span) t = t.slice(Math.min(a.local, b.local), Math.max(a.local, b.local))
      else if (sp === a.span) t = t.slice(a.local)
      else if (sp === b.span) t = t.slice(0, b.local)
      const top = sp.dataset.line + '|' + (sp.dataset.p ?? '')
      if (out && lastTop && top !== lastTop && !/\s$/.test(out) && !cjk.test(out.slice(-1)) && !cjk.test(t[0] ?? '')) out += ' '
      out += t
      lastTop = top
    }
    return out.replace(/\s+/g, ' ').trim()
  }

  /**
   * Mark whose painted band lies under a viewport point.
   * Word boxes fill the line, so a click in the gap between highlight bars still hits a span;
   * that click is not on the mark.
   */
  markAt(clientX: number, clientY: number, marks: Annotation[], from?: EventTarget | null): Annotation | null {
    const hinted = from instanceof Element ? from.closest('span.w') : null
    const el = (hinted ?? document.elementFromPoint(clientX, clientY)) as HTMLElement | null
    const span = el?.closest?.('span.w') as HTMLElement | null
    if (!span || !this.root.contains(span)) return null
    const slot = this.slots.find((s) => s.el.contains(span))
    const box = slot?.words.find((w) => w.el === span)
    const page = slot?.page
    if (!box || !page) return null
    const local = this.pointInBox(span, box, clientX, clientY)
    if (!local) return null
    const origin = contentOrigin(page, this.cfg)
      return markUnderPoint(page, box.x - origin.x + local.x, box.y - origin.y + local.y, marks, this.cfg)
  }

  private pointInBox(span: HTMLElement, box: TextBox, clientX: number, clientY: number) {
    const transform = span.style.transform
    if (transform && transform !== 'none') {
      const host = this.root.getBoundingClientRect()
      const m = new DOMMatrix(transform)
      const local = localInProjectedBox(m, clientX - host.left, clientY - host.top)
      if (local) return local
    }
    const r = span.getBoundingClientRect()
    if (r.width < 0.5 || r.height < 0.5) return null
    return { x: ((clientX - r.left) / r.width) * box.w, y: ((clientY - r.top) / r.height) * box.h }
  }

  /** Persistent, native-looking selection (kept while focus moves into popovers). */
  showPseudoSelection(loc: Locator | null) {
    for (const s of this.slots) {
      s.sel.replaceChildren()
      s.highlights = []
      if (!loc || !s.page || s.page.special || s.page.chapter !== loc.chapter) continue
      if (loc.end <= s.page.start || loc.start >= s.page.end) continue
      const o = contentOrigin(s.page, this.cfg)
      for (const r of rangeRects(s.page, loc.start, loc.end)) {
        const d = document.createElement('div')
        d.className = 'sel-rect'
        s.highlights.push({ el: d, x: o.x + r.x0 - 1, y: o.y + r.line.y + r.line.baseline - this.cfg.fontSize * 0.88, w: r.x1 - r.x0 + 2, h: this.cfg.fontSize * 1.16 })
        s.sel.appendChild(d)
      }
      this.projectHighlights(s)
    }
  }

  clearNativeSelection() {
    window.getSelection()?.removeAllRanges()
  }

  /** Character caret under the pointer, including justified gaps, in projected page coordinates. */
  caretAt(clientX: number, clientY: number) {
    for (const slot of this.slots) for (const box of slot.words) {
      const p = this.pointInBox(box.el, box, clientX, clientY)
      if (!p || p.x < 0 || p.x > box.w || p.y < 0 || p.y > box.h) continue
      const start = Number(box.el.dataset.s), end = Number(box.el.dataset.e)
      if (end <= start) continue
      const text = (box.el.textContent ?? '').slice(0, end - start)
      let prefix = '', offset = 0, before = 0
      for (const char of text) {
        prefix += char
        const after = measure(box.el.style.font, prefix)
        if (p.x < (before + after) / 2) break
        offset += char.length
        before = after
      }
      return { chapter: Number(box.el.dataset.c), offset: start + offset, page: Number(box.el.dataset.p), rect: box.el.getBoundingClientRect() }
    }
    return null
  }

  /** Lower-right continuation zone follows the projected text area, not the browser viewport. */
  forwardSelectionEdge() {
    const slot = this.slots[1], page = slot.page, last = slot.words.at(-1)
    if (!page || !last || !slot.project || page.special) return null
    const point = slot.project(this.cfg.pageW - this.cfg.marginOuter, last.y + last.h)
    const host = this.root.getBoundingClientRect()
    return { x: host.left + point.x, y: host.top + point.y, chapter: page.chapter, page: page.index,
      start: Number(last.el.dataset.s), end: Number(last.el.dataset.e) }
  }

  dispose() {
    this.root.remove()
  }
}

/** Projective map from a w x h word box onto four points on the rendered sheet. */
function quadToCss(q: { x: number; y: number }[], w: number, h: number): string {
  const [p0, p1, p2, p3] = q
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y
  const den = dx1 * dy2 - dx2 * dy1
  const g = Math.abs(den) < 1e-9 ? 0 : (sx * dy2 - dx2 * sy) / den
  const hh = Math.abs(den) < 1e-9 ? 0 : (dx1 * sy - sx * dy1) / den
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + hh * p3.x
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + hh * p3.y
  return `matrix3d(${[a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, p0.x, p0.y, 0, 1].join(',')})`
}
