import { useEffect, useRef, useState } from 'react'
import { wheelIntent, type WebKitGesture } from '../engine/viewGestures'

interface Point { x: number; y: number }
interface Camera extends Point { scale: number }
export const MIN_MAP_ZOOM = .2
export const MAX_MAP_ZOOM = 3
const clamp = (scale: number) => Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, scale))
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** Canvas-owned gestures, including Safari pinch events; never changes page/reader zoom. */
export function useMindmapCanvas(enabled: boolean) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const camera = useRef<Camera>({ x: 0, y: 0, scale: 1 })
  const [zoom, setZoom] = useState(1)
  const apply = (next: Camera) => {
    camera.current = next
    if (content.current) content.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`
    setZoom(next.scale)
  }
  const center = () => ({ x: (viewport.current?.clientWidth ?? 0) / 2, y: (viewport.current?.clientHeight ?? 0) / 2 })
  const zoomAt = (scale: number, point = center()) => {
    const previous = camera.current, next = clamp(scale), ratio = next / previous.scale
    apply({ scale: next, x: point.x - (point.x - previous.x) * ratio, y: point.y - (point.y - previous.y) * ratio })
  }
  const reset = () => apply({ x: 0, y: 0, scale: 1 })
  const fit = () => {
    const view = viewport.current, tree = content.current
    if (!view || !tree) return
    const scale = clamp(Math.min(1, (view.clientWidth - 32) / tree.offsetWidth, (view.clientHeight - 32) / tree.offsetHeight))
    apply({ scale, x: (view.clientWidth - tree.offsetWidth * scale) / 2, y: (view.clientHeight - tree.offsetHeight * scale) / 2 })
  }
  useEffect(() => {
    const view = viewport.current
    if (!enabled || !view) return
    const points = new Map<number, Point>()
    let origin: Point | null = null, dragging = false, suppressClick = false
    let nativeGesture: { zoom: number; point: Point } | null = null
    const local = (event: { clientX: number; clientY: number }) => {
      const rect = view.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const capture = (id: number) => { if (!view.hasPointerCapture(id)) view.setPointerCapture(id) }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || points.size >= 2) return
      if (!points.size) { suppressClick = false; dragging = false; origin = local(event) }
      points.set(event.pointerId, local(event))
      // Keep release events even outside the canvas, without changing a tap's click target.
      if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId)
      if (points.size === 2) {
        dragging = true; suppressClick = true
        points.forEach((_, id) => capture(id))
      }
    }
    const move = (event: PointerEvent) => {
      const previousPoint = points.get(event.pointerId)
      if (!previousPoint) return
      if (event.pointerType === 'mouse' && !(event.buttons & 1)) { up(event); return }
      const before = [...points.values()], point = local(event)
      points.set(event.pointerId, point)
      const after = [...points.values()]
      if (points.size === 2) {
        const oldCenter = middle(before[0], before[1]), newCenter = middle(after[0], after[1])
        const previous = camera.current
        const scale = clamp(previous.scale * distance(after[0], after[1]) / Math.max(1, distance(before[0], before[1])))
        const ratio = scale / previous.scale
        apply({ scale, x: newCenter.x - (oldCenter.x - previous.x) * ratio, y: newCenter.y - (oldCenter.y - previous.y) * ratio })
      } else {
        if (!dragging && (!origin || distance(point, origin) < 5)) return
        dragging = true; suppressClick = true; capture(event.pointerId)
        apply({ ...camera.current, x: camera.current.x + point.x - previousPoint.x, y: camera.current.y + point.y - previousPoint.y })
      }
      view.classList.add('is-panning')
      event.preventDefault()
    }
    const up = (event: PointerEvent) => {
      points.delete(event.pointerId)
      if (view.hasPointerCapture(event.pointerId)) view.releasePointerCapture(event.pointerId)
      if (!points.size) { dragging = false; origin = null; view.classList.remove('is-panning') }
      else origin = [...points.values()][0]
    }
    const click = (event: MouseEvent) => {
      // Native pointer clicks after a drag/pinch must not collapse the node underneath.
      // Keyboard activation (detail=0) remains available.
      if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const lost = (event: PointerEvent) => { if (event.target === view) up(event) }
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation()
      const intent = wheelIntent(event, view)
      if (intent.kind === 'zoom') {
        if (nativeGesture) return
        zoomAt(camera.current.scale * intent.factor, local(event))
      } else {
        // The desk moves its camera; this canvas moves the content in the opposite direction.
        apply({ ...camera.current, x: camera.current.x - intent.x, y: camera.current.y - intent.y })
      }
    }
    const gesture = (event: Event) => {
      const e = event as WebKitGesture
      if (e.type === 'gesturestart') {
        const rect = view.getBoundingClientRect()
        nativeGesture = { zoom: camera.current.scale, point: local({ clientX: e.clientX ?? rect.left + rect.width / 2, clientY: e.clientY ?? rect.top + rect.height / 2 }) }
      }
      if (!nativeGesture) return
      if (e.cancelable) e.preventDefault()
      e.stopPropagation()
      if (e.type === 'gestureend') { nativeGesture = null; return }
      if (e.type !== 'gesturechange' || !Number.isFinite(e.scale) || e.scale <= 0 || points.size > 1) return
      zoomAt(nativeGesture.zoom * e.scale, nativeGesture.point)
    }
    const key = (event: KeyboardEvent) => {
      if (event.target !== view) return
      if (event.key === '+' || event.key === '=') zoomAt(camera.current.scale * 1.1)
      else if (event.key === '-') zoomAt(camera.current.scale / 1.1)
      else if (event.key === '0') reset()
      else if (event.key.startsWith('Arrow')) apply({ ...camera.current, x: camera.current.x + (event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0), y: camera.current.y + (event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0) })
      else return
      event.preventDefault(); event.stopPropagation()
    }
    view.addEventListener('pointerdown', down)
    view.addEventListener('pointermove', move)
    view.addEventListener('pointerup', up)
    view.addEventListener('pointercancel', up)
    view.addEventListener('lostpointercapture', lost)
    view.addEventListener('click', click, true)
    view.addEventListener('wheel', wheel, { passive: false })
    view.addEventListener('gesturestart', gesture, { passive: false })
    window.addEventListener('gesturechange', gesture, { capture: true, passive: false })
    window.addEventListener('gestureend', gesture, { capture: true, passive: false })
    view.addEventListener('keydown', key)
    return () => {
      points.forEach((_, id) => { if (view.hasPointerCapture(id)) view.releasePointerCapture(id) })
      view.classList.remove('is-panning')
      view.removeEventListener('pointerdown', down)
      view.removeEventListener('pointermove', move)
      view.removeEventListener('pointerup', up)
      view.removeEventListener('pointercancel', up)
      view.removeEventListener('lostpointercapture', lost)
      view.removeEventListener('click', click, true)
      view.removeEventListener('wheel', wheel)
      view.removeEventListener('gesturestart', gesture)
      window.removeEventListener('gesturechange', gesture, true)
      window.removeEventListener('gestureend', gesture, true)
      view.removeEventListener('keydown', key)
    }
    // The handlers read the current camera through a ref; bind once per mounted canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
  return { viewport, content, zoom, zoomAt, reset, fit }
}
