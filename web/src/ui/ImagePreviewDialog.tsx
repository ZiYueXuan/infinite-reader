import { t } from '../i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ParsedBook } from '../book/types'
import type { ReaderScene } from '../engine/scene'
import { Icon } from './icons'
import { INITIAL_IMAGE_VIEW, constrainImage, imageFit, zoomImage, type ImageSize } from './imagePreviewGeometry'
import './imagePreview.css'

const EMPTY_SIZE: ImageSize = { width: 0, height: 0 }

export function ImagePreviewDialog({ book, path, scene, onClose, onOpenMap }: {
  book: ParsedBook; path: string; scene: ReaderScene; onClose: () => void; onOpenMap: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [natural, setNatural] = useState(EMPTY_SIZE)
  const [viewport, setViewport] = useState(EMPTY_SIZE)
  const [requestedView, setView] = useState(INITIAL_IMAGE_VIEW)
  const [dragging, setDragging] = useState(false)
  const view = constrainImage(requestedView, natural, viewport)
  const ready = !!url && natural.width > 0 && !error
  const scale = imageFit(natural, viewport, view.rotation) * view.zoom
  const fileName = Array.from(path.split('/').pop() || 'book-image').map((c) => c.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(c) ? '_' : c).join('')

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    scene.suspendInteraction(true)
    el.showModal()
    close.current?.focus()
    return () => {
      el.close()
      scene.suspendInteraction(false)
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return
        const target = previous?.isConnected && previous !== document.body
          ? previous : document.querySelector<HTMLElement>(`[data-book-image="${CSS.escape(path)}"]`)
        target?.focus({ preventScroll: true })
      })
    }
  }, [scene, path])

  useEffect(() => {
    let active = true, objectUrl: string | null = null
    book.getImage(path).then((blob) => {
      if (!active) return
      if (!blob) { setError(true); return }
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [book, path])

  useLayoutEffect(() => {
    const el = stage.current!
    const resize = () => setViewport({ width: Math.max(1, el.clientWidth - 32), height: Math.max(1, el.clientHeight - 32) })
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()
    return () => observer.disconnect()
  }, [])

  const zoom = useCallback((factor: number, pivot = { x: 0, y: 0 }) => {
    setView((v) => zoomImage(constrainImage(v, natural, viewport), factor, pivot, natural, viewport))
  }, [natural, viewport])

  useEffect(() => {
    const el = stage.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      if (!ready) return
      const rect = el.getBoundingClientRect()
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1)
      zoom(Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.002), { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 })
    }
    const preventBrowserPinch = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    const modal = dialog.current!
    el.addEventListener('wheel', wheel, { passive: false })
    modal.addEventListener('wheel', preventBrowserPinch, { passive: false })
    return () => { el.removeEventListener('wheel', wheel); modal.removeEventListener('wheel', preventBrowserPinch) }
  }, [ready, zoom])

  const pointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    setDragging(pointers.current.size > 0)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const pointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId)
    if (!previous || !ready) return
    const before = [...pointers.current.values()]
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const after = [...pointers.current.values()]
    if (before.length >= 2) {
      const distance = (p: typeof before) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
      const midpoint = (p: typeof before) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 })
      const oldMid = midpoint(before), newMid = midpoint(after)
      const rect = e.currentTarget.getBoundingClientRect()
      const factor = distance(after) / Math.max(1, distance(before))
      setView((v) => {
        const next = zoomImage(v, factor, { x: oldMid.x - rect.left - rect.width / 2, y: oldMid.y - rect.top - rect.height / 2 }, natural, viewport)
        return constrainImage({ ...next, x: next.x + newMid.x - oldMid.x, y: next.y + newMid.y - oldMid.y }, natural, viewport)
      })
    } else {
      setView((v) => constrainImage({ ...v, x: v.x + e.clientX - previous.x, y: v.y + e.clientY - previous.y }, natural, viewport))
    }
  }

  return <dialog ref={dialog} className="image-preview" data-ui aria-labelledby="image-preview-title"
    onCancel={(e) => { e.preventDefault(); onClose() }} onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault()
      if (!ready || e.altKey) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.25) }
      if (e.key === '-') { e.preventDefault(); zoom(0.8) }
      if (e.key === '0') { e.preventDefault(); setView(INITIAL_IMAGE_VIEW) }
    }}>
    <header className="image-preview-header">
      <div><span className="image-preview-eyebrow">INFINITE READER</span><h2 id="image-preview-title">{t("书中原图")}</h2></div>
      <button ref={close} type="button" className="image-preview-close" onClick={onClose} aria-label={t("关闭图片，返回阅读")} title={t("关闭图片 · Esc")}><Icon.close /><span>{t("返回书页")}</span><kbd>Esc</kbd></button>
    </header>
    <div ref={stage} className={'image-preview-stage' + (dragging ? ' dragging' : '') + (ready && view.zoom > 1 ? ' pannable' : '')}
      onPointerDown={(e) => {
        if (!ready || e.button !== 0) return
        e.preventDefault()
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={(e) => {
        pointers.current.delete(e.pointerId); setDragging(pointers.current.size > 0)
      }} onDoubleClick={(e) => {
        if (!ready) return
        const rect = e.currentTarget.getBoundingClientRect()
        if (view.zoom > 1) setView((v) => ({ ...v, zoom: 1, x: 0, y: 0 }))
        else zoom(2, { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 })
      }}>
      {url && !error && <img src={url} alt={t("书中图片原图")} draggable={false} onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} onError={() => setError(true)}
        style={{ width: natural.width || undefined, height: natural.height || undefined, visibility: ready ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${view.rotation}deg) scale(${scale})` }} />}
      {!ready && <p className="image-preview-status" role="status">{error ? t("暂时无法读取这张图片，请关闭后重试。") : t("正在读取原图…")}</p>}
    </div>
    <footer className="image-preview-footer">
      <div className="image-preview-tools" role="group" aria-label={t("图片预览工具")}>
        <button type="button" title={t("缩小")} aria-label={t("缩小图片")} disabled={!ready || view.zoom <= 0.25} onClick={() => zoom(0.8)}><Icon.minus /></button>
        <output className="image-preview-scale" aria-label={t("图片缩放比例")}>{ready ? `${Math.round(scale * 100)}%` : '—'}</output>
        <button type="button" title={t("放大")} aria-label={t("放大图片")} disabled={!ready || view.zoom >= 8} onClick={() => zoom(1.25)}><Icon.plus /></button>
        <span className="image-preview-separator" aria-hidden />
        <button type="button" title={t("适应窗口")} aria-label={t("图片适应窗口")} disabled={!ready} onClick={() => setView((v) => ({ ...v, zoom: 1, x: 0, y: 0 }))}><Icon.fit /></button>
        <button type="button" title={t("顺时针旋转 90°")} aria-label={t("顺时针旋转图片")} disabled={!ready} onClick={() => setView((v) => ({ zoom: v.zoom, rotation: (v.rotation + 90) % 360, x: 0, y: 0 }))}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></svg>
        </button>
        <span className="image-preview-separator" aria-hidden />
        <a className="image-preview-save" href={ready ? url! : undefined} download={fileName} aria-disabled={!ready} tabIndex={ready ? 0 : -1} aria-label={t("保存图片原图")} title={t("保存原图")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v12m-5-5 5 5 5-5M5 20h14" /></svg><span>{t("保存")}</span>
        </a>
        <span className="image-preview-separator" aria-hidden />
        <button type="button" className="image-preview-map" disabled={!ready} onClick={onOpenMap} aria-label={t("识别地图并在地球中查看")} title={t("识别地图并在地球中查看")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" /></svg>
        </button>
      </div>
      <p className="image-preview-hint">{t("滚动缩放 · 放大后拖动查看")}</p>
    </footer>
  </dialog>
}
