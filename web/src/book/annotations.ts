import { noteFontIdOf, type NoteFontId } from './noteFontCatalog.ts'

export type MarkKind = 'highlight' | 'underline' | 'judou'
export type MarkColor = 'yellow' | 'pink' | 'green' | 'blue' | 'orange' | 'violet'

/** Reader-added clause marks (句读). Vermilion keeps them apart from the book's printed punctuation. */
export const JUDOU_DEFAULT_SYMBOL = '/'
export const JUDOU_INK = '#b4472f'

/** One stored character; records written before the field existed fall back to the default. */
export function judouSymbolOf(symbol: string | undefined) {
    return Array.from(symbol?.trim() ?? '')[0] ?? JUDOU_DEFAULT_SYMBOL
}

/** A clause mark belongs to one character: the last one of whatever range the reader acted on. */
export function judouCharOf(loc: Locator): Locator {
    const start = Math.max(loc.start, loc.end - 1)
    return {chapter: loc.chapter, start, end: start + 1}
}

/**
 * The clause mark a `/` press should toggle. A caret is ambiguous: it sits between two characters,
 * and readers click either half of a marked character expecting the mark to go. So an existing mark
 * on the character before or after the caret both win over adding a new one.
 */
export function judouToggleRange(loc: Locator, marks: Annotation[], caret: boolean): Locator {
    const target = judouCharOf(loc)
    if (!caret) return target
    const has = (r: Locator) => marks.some((a) => a.kind === 'judou' &&
        a.locator.chapter === r.chapter && a.locator.start === r.start && a.locator.end === r.end)
    if (has(target)) return target
    // An empty range means the caret is at the chapter start: no neighbour before it, and the first
    // character itself must not be treated as the "next" one.
    if (loc.end <= loc.start) return target
    const next = {chapter: target.chapter, start: target.end, end: target.end + 1}
    return has(next) ? next : target
}

export type NoteTextColor = 'default' | MarkColor

/** Reading inks, deliberately darker than the original-text highlight swatches. */
export const NOTE_TEXT_COLORS: Record<NoteTextColor, { ink: string; label: string }> = {
  default: { ink: '#62584b', label: 'Default' },
  yellow: { ink: '#7a5a12', label: 'Ochre' },
  pink: { ink: '#9b3559', label: 'Rose' },
  green: { ink: '#32613b', label: 'Green' },
  blue: { ink: '#315f91', label: 'Blue' },
  orange: { ink: '#945023', label: 'Rust' },
  violet: { ink: '#69469a', label: 'Violet' },
}

export function noteTextColorOf(value: unknown): NoteTextColor {
  return typeof value === 'string' && Object.hasOwn(NOTE_TEXT_COLORS, value) ? value as NoteTextColor : 'default'
}

export const MARK_COLORS: Record<MarkColor, { fill: string; ink: string; note: string; label: string }> = {
  yellow: { fill: '#ffe45c', ink: '#d9a400', note: '#ffe97a', label: 'Yellow' },
  pink: { fill: '#ff9cbc', ink: '#d6336c', note: '#ffa8c5', label: 'Pink' },
  green: { fill: '#9be58b', ink: '#2f9e44', note: '#b4ee9f', label: 'Green' },
  blue: { fill: '#8ccbff', ink: '#1c7ed6', note: '#9fd6ff', label: 'Blue' },
  orange: { fill: '#ffba70', ink: '#e8590c', note: '#ffc891', label: 'Orange' },
  violet: { fill: '#c9a8ff', ink: '#7048e8', note: '#d6bcff', label: 'Violet' },
}

export interface Locator {
  chapter: number
  start: number
  end: number
}

/** Legacy wire shape retained for existing local and cloud notes; positions are no longer rendered. */
export interface StickyNote {
  text: string
  /** Independent of the original passage's highlight/underline colour. */
  textColor?: NoteTextColor
  /** Missing means follow the reader font, preserving existing notes. */
  font?: NoteFontId
  /** Legacy desk position, retained for backwards-compatible storage. */
  x: number
  y: number
  /** Legacy desk rotation, retained for backwards-compatible storage. */
  rot: number
  /** up to five short labels; omitted when the note has none */
  tags?: string[]
}

/** The persisted annotation record (also the wire format of /api/annotations). */
export interface Annotation {
  id: string
  bookId: string
  locator: Locator
  quote: string
  kind: MarkKind
  color: MarkColor
    /** 句读 glyph; only meaningful for kind === 'judou', where missing means JUDOU_DEFAULT_SYMBOL. */
    symbol?: string
  note?: StickyNote
  createdAt: number
  updatedAt: number
}

/** Identity of a synced annotation. Tag-only edits must not be treated as already saved. */
export function annotationSignature(a: Annotation) {
  const tags = a.note?.tags?.length ? a.note.tags : null
    return JSON.stringify([a.kind, a.color, a.kind === 'judou' ? judouSymbolOf(a.symbol) : null, a.note ? [a.note.text, Math.round(a.note.x * 100), Math.round(a.note.y * 100), Math.round(a.note.rot * 1000), tags, noteTextColorOf(a.note.textColor), noteFontIdOf(a.note.font)] : null])
}

/** Only note content and placement affect pagination, not sync timestamps or legacy desk positions. */
export function noteLayoutSignature(annotations: readonly Annotation[]) {
  return JSON.stringify(annotations.filter(a => a.note).slice().sort((a, b) => a.id.localeCompare(b.id)).map(a => [
    a.id, a.locator.chapter, a.locator.start, a.locator.end, a.createdAt,
    noteTextColorOf(a.note!.textColor), noteFontIdOf(a.note!.font), a.note!.text, a.note!.tags ?? [],
  ]))
}

export function uid() {
  return (Math.random().toString(36).slice(2) + '00000000').slice(0, 8) + Date.now().toString(36).slice(-4)
}

export function hash(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rng(seed: number) {
  let a = seed || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
