export interface NoteEditorSize { width: number; height: number }

interface Rect { left: number; top: number; width: number; height: number }

/** Keep the quote editor beside its text, with enough room to type and reach its controls. */
export function noteEditorLayout(note: Rect, viewport: Rect, preferred?: NoteEditorSize | null) {
  const margin = 12
  const width = Math.min(Math.max(280, preferred?.width ?? Math.min(note.width, 520)), Math.max(1, viewport.width - margin * 2))
  const height = Math.min(Math.max(210, preferred?.height ?? Math.min(note.height + 90, 360)), Math.max(1, viewport.height - margin * 2))
  const x = Math.max(viewport.left + margin, Math.min(note.left, viewport.left + viewport.width - margin - width))
  const y = Math.max(viewport.top + margin, Math.min(note.top, viewport.top + viewport.height - margin - height))
  return { x, y, width, height }
}

export const NOTE_EDITOR_SIZE_KEY = 'ir:note-editor-size'
export interface NoteEditorGeometry {
  size: NoteEditorSize | null
  anchor: { left: number; top: number } | null
}
export function initialNoteEditorGeometry(): NoteEditorGeometry {
  try {
    const value = JSON.parse(localStorage.getItem(NOTE_EDITOR_SIZE_KEY) ?? 'null')
    if (value && Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0) return { size: value, anchor: null }
  } catch { /* storage is optional */ }
  return { size: null, anchor: null }
}
