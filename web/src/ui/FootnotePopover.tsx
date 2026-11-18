import { t } from '../i18n'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Footnote } from '../book/types'
import './footnote.css'

export interface OpenFootnote { note: Footnote; anchor: HTMLButtonElement }

export function FootnotePopover({ opened, onClose }: { opened: OpenFootnote; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useLayoutEffect(() => { close.current = onClose })
  useEffect(() => {
    const el = ref.current!, anchor = opened.anchor
    let frame = 0
    const place = () => {
      if (!anchor.isConnected || anchor.disabled || !anchor.getClientRects().length) { close.current(); return }
      const r = anchor.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const vw = viewport?.width ?? innerWidth, vh = viewport?.height ?? innerHeight
      el.style.maxWidth = `${Math.max(0, vw - 24)}px`
      const below = top + vh - r.bottom - 20, above = r.top - top - 20
      const down = below >= Math.min(240, vh * .45) || below >= above
      el.style.maxHeight = `${Math.max(80, down ? below : above)}px`
      const w = el.offsetWidth, h = el.offsetHeight
      const x = Math.max(left + 12, Math.min(r.left + r.width / 2 - w / 2, left + vw - w - 12))
      el.style.left = `${x}px`
      el.style.top = `${Math.max(top + 12, Math.min(down ? r.bottom + 10 : r.top - h - 10, top + vh - h - 12))}px`
      el.style.setProperty('--arrow-x', `${Math.max(20, Math.min(w - 20, r.left + r.width / 2 - x))}px`)
      el.dataset.side = down ? 'below' : 'above'
      frame = requestAnimationFrame(place)
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !el.contains(event.target) && !anchor.contains(event.target)) close.current()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); anchor.focus({ preventScroll: true }) }
    }
    anchor.setAttribute('aria-expanded', 'true')
    place()
    el.focus({ preventScroll: true })
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    return () => {
      cancelAnimationFrame(frame)
      anchor.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [opened])
  return <div ref={ref} className="footnote-popover" data-ui role="dialog" aria-label={t("书中注释")} tabIndex={-1}
    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <div className="footnote-heading"><span>{t("书中注释")}</span><button type="button" aria-label={t("关闭脚注")} onClick={() => { onClose(); opened.anchor.focus({ preventScroll: true }) }}>×</button></div>
    <div className="footnote-content">{opened.note.text}</div>
  </div>
}
