import { useRef, type RefObject } from 'react'
import { t } from '../i18n'
import { noteEditorLayout, NOTE_EDITOR_SIZE_KEY, type NoteEditorGeometry } from './noteEditorLayout'

function persist(geometry: NoteEditorGeometry) {
  try {
    if (geometry.size) localStorage.setItem(NOTE_EDITOR_SIZE_KEY, JSON.stringify(geometry.size))
    else localStorage.removeItem(NOTE_EDITOR_SIZE_KEY)
  } catch { /* resizing still works for this editor */ }
}

export function NoteResizeHandle({ editor, onResize }: { editor: RefObject<HTMLDivElement | null>; onResize: (geometry: NoteEditorGeometry) => void }) {
  const geometry = useRef<NoteEditorGeometry>({ size: null, anchor: null })
  const apply = (next: NoteEditorGeometry) => { geometry.current = next; onResize(next) }
  const drag = useRef<{ pointer: number; x: number; y: number; rect: DOMRect; dirty: boolean } | null>(null)
  const resize = (rect: DOMRect, dx: number, dy: number) => {
    const v = window.visualViewport
    const viewport = { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0, width: v?.width ?? innerWidth, height: v?.height ?? innerHeight }
    // Hold the top-left corner still during a drag; grow only into the available space.
    const maxWidth = viewport.left + viewport.width - 12 - rect.left
    const maxHeight = viewport.top + viewport.height - 12 - rect.top
    const size = { width: Math.min(maxWidth, Math.max(280, rect.width + dx)), height: Math.min(maxHeight, Math.max(210, rect.height + dy)) }
    const next = noteEditorLayout(rect, viewport, size)
    apply({ size: { width: next.width, height: next.height }, anchor: { left: next.x, top: next.y } })
  }
  const reset = () => { apply({ size: null, anchor: null }); persist(geometry.current) }
  return <button type="button" className="note-resize-handle" data-note-resize
    aria-label={t("调整笔记编辑框大小")}
    title={t("拖动调整大小；双击恢复默认。也可使用方向键调整。")}
    onPointerDown={event => {
      if (event.button !== 0 || !editor.current) return
      event.stopPropagation()
      event.currentTarget.focus({ preventScroll: true })
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, rect: editor.current.getBoundingClientRect(), dirty: false }
    }}
    onPointerMove={event => {
      const start = drag.current
      if (!start || start.pointer !== event.pointerId) return
      event.preventDefault(); event.stopPropagation()
      resize(start.rect, event.clientX - start.x, event.clientY - start.y)
      start.dirty = true
    }}
    onPointerUp={event => {
      if (drag.current?.pointer !== event.pointerId) return
      if (drag.current.dirty) persist(geometry.current)
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onLostPointerCapture={() => { if (drag.current?.dirty) persist(geometry.current); drag.current = null }}
    onDoubleClick={reset}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reset(); return }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !editor.current) return
      event.preventDefault()
      const step = event.shiftKey ? 60 : 20
      resize(editor.current.getBoundingClientRect(), event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
      persist(geometry.current)
    }}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M4 12 12 4M8 12l4-4M12 12h.01" /></svg>
  </button>
}
