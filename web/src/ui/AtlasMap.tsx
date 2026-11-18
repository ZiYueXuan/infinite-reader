import { getLocale, useT } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as GlobeMap } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { BookMap } from '../atlas/catalog'
import { WATER_DETAIL_SOURCE, watchWaterDetail } from '../atlas/hydrology'
import { atlasStyle } from '../atlas/mapStyle'
import { ATLAS_MAX_ZOOM, findTerrainFocus, TERRAIN_VIEW } from '../atlas/terrainView'
import 'maplibre-gl/dist/maplibre-gl.css'

maplibregl.setWorkerUrl(workerUrl)

export interface AtlasMapProps { atlas: Omit<BookMap, 'image'>; selected: string | null; onSelect: (id: string | null) => void; compact?: boolean; readingMap?: boolean; focusPlace?: Pick<BookMap['places'][number], 'id' | 'coordinates'> }

const RECOGNIZED_PLACE_ZOOM = 9

export default function AtlasMap({ atlas, selected, onSelect, compact = false, readingMap = false, focusPlace }: AtlasMapProps) {
  const t = useT()
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GlobeMap | null>(null)
  const requestedFocus = useRef(focusPlace)
  const markers = useRef(new Map<string, HTMLButtonElement>())
  const select = useRef(onSelect)
  const terrainFlight = useRef<'overview' | 'refine' | 'detail' | null>(null)
  const terrainTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const returnView = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [fatal, setFatal] = useState(false)
  const [waterLimited, setWaterLimited] = useState(false)
  const [limited, setLimited] = useState(false)
  const [terrain, setTerrain] = useState(false)
  const [terrainLoading, setTerrainLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const motion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const cancelTerrainFlight = useCallback(() => {
    terrainFlight.current = null
    if (terrainTimer.current !== null) clearTimeout(terrainTimer.current)
    terrainTimer.current = null
    setTerrainLoading(false)
  }, [])

  useEffect(() => { select.current = onSelect }, [onSelect])
  useEffect(() => { requestedFocus.current = focusPlace }, [focusPlace])
  useEffect(() => {
    const el = container.current!
    // A changed set of places creates a fresh map; never retain the old readiness/terrain UI.
    // eslint-disable-next-line react/set-state-in-effect
    setReady(false); setTerrain(false); setTerrainLoading(false); setFatal(false); setLimited(false); setWaterLimited(false)
    let map: GlobeMap | null = null
    let stopWaterDetail: (() => void) | undefined
    const buttons = markers.current
    try {
      map = new maplibregl.Map({
        locale: { 'Map.Title': t('Map'), 'AttributionControl.ToggleAttribution': t('Toggle attribution'),
          'NavigationControl.ZoomIn': t('放大'), 'NavigationControl.ZoomOut': t('缩小'),
          'NavigationControl.ResetBearing': t('Drag to rotate map, click to reset north') },
        container: el, style: atlasStyle(location.origin, getLocale()), center: [atlas.center[0] - 24, 20], zoom: 1.35,
        minZoom: 0.6, maxZoom: ATLAS_MAX_ZOOM, maxPitch: 75, renderWorldCopies: false,
        // The miniature shares the reading workspace: arrow keys belong to the book.
        keyboard: !compact,
        attributionControl: false, canvasContextAttributes: { antialias: true },
      })
      mapRef.current = map
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
      const current = map
      stopWaterDetail = watchWaterDetail(current, setWaterLimited)
      current.on('load', () => {
        setReady(true)
        const focus = requestedFocus.current
        if (focus) current.flyTo({ center: focus.coordinates, zoom: RECOGNIZED_PLACE_ZOOM, duration: motion() ? 1200 : 0 })
        else current.fitBounds(atlas.bounds, { padding: 64, duration: motion() ? 1500 : 0, maxZoom: readingMap ? 10 : 5.7 })
      })
      current.on('error', (event) => {
        if ('sourceId' in event) {
          // Hydrology owns its fallback and notice independently of terrain failures.
          if (event.sourceId === WATER_DETAIL_SOURCE) return
          setLimited(true)
          if (event.sourceId === 'terrain' && current.getTerrain()) {
            cancelTerrainFlight()
            current.stop().setTerrain(null)
            current.easeTo({ pitch: 0, duration: 0 })
            setTerrain(false)
          }
          if (event.sourceId === 'water') {
            // The land-only DEM palette must never render without its coastline mask.
            current.setLayoutProperty('elevation-color', 'visibility', 'none')
            current.setLayoutProperty('hillshade', 'visibility', 'none')
          }
        }
        else setFatal(true)
      })
      const finishTerrainFlight = () => {
        if (terrainFlight.current === 'overview' || terrainFlight.current === 'refine') {
          const refine = terrainFlight.current === 'refine'
          const fallback = atlas.places[0]?.coordinates ?? atlas.center
          const near = refine ? current.getCenter().toArray() : undefined
          const center = findTerrainFocus(atlas.bounds, (point) => current.queryTerrainElevation(point), near ?? fallback, near)
          // Global DEMs locate the range, then regional DEMs locate an actual ridge within it.
          terrainFlight.current = refine ? 'detail' : 'refine'
          current.flyTo({ center, zoom: refine ? TERRAIN_VIEW.zoom : 7.5, pitch: refine ? TERRAIN_VIEW.pitch : 0, bearing: 0, duration: motion() ? 1200 : 0 })
        } else if (terrainFlight.current === 'detail') cancelTerrainFlight()
      }
      const exitDistantTerrain = () => {
        if (current.getTerrain() && !terrainFlight.current && current.getZoom() < 6) {
          current.setTerrain(null)
          current.easeTo({ pitch: 0, duration: motion() ? 400 : 0 })
          setTerrain(false)
        }
      }
      current.on('idle', finishTerrainFlight)
      current.on('moveend', exitDistantTerrain)
      // Direct manipulation must cancel a pending automatic focus, never move the user back later.
      el.addEventListener('pointerdown', cancelTerrainFlight)
      el.addEventListener('wheel', cancelTerrainFlight, { passive: true })
      el.addEventListener('keydown', cancelTerrainFlight)
      for (const place of atlas.places) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'atlas-marker'
        button.setAttribute('aria-label', t("定位{0}", place.name))
        const dot = document.createElement('i'), label = document.createElement('span')
        label.textContent = place.name
        button.append(dot, label)
        button.onclick = () => select.current(place.id)
        buttons.set(place.id, button)
        new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat(place.coordinates).addTo(current)
      }
      let labelFrame = 0
      const labels = () => {
        if (labelFrame) return
        labelFrame = requestAnimationFrame(() => {
          labelFrame = 0
          const visible = current.getZoom() >= 2.2
          el.dataset.labels = visible ? 'visible' : 'hidden'
          if (!visible) return
          const viewport = el.getBoundingClientRect()
          // Measure first, then hide colliding labels. Keep every city dot and list entry.
          const candidates = [...buttons.values()].map((button) => ({
            button, box: button.querySelector('span')!.getBoundingClientRect(),
            priority: button.classList.contains('selected') || button.matches(':hover, :focus-visible'),
          })).sort((a, b) => Number(b.priority) - Number(a.priority))
          const occupied: DOMRect[] = []
          for (const { button, box, priority } of candidates) {
            const fits = box.left >= viewport.left + 4 && box.right <= viewport.right - 4 && box.top >= viewport.top + 4 && box.bottom <= viewport.bottom - 4
            const overlaps = occupied.some((r) => box.left < r.right + 5 && box.right > r.left - 5 && box.top < r.bottom + 4 && box.bottom > r.top - 4)
            const show = priority || (fits && !overlaps)
            button.dataset.labelHidden = String(!show)
            if (show) occupied.push(box)
          }
        })
      }
      current.on('move', labels)
      current.on('resize', labels)
      const labelEvents = ['pointerover', 'pointerout', 'focusin', 'focusout'] as const
      for (const event of labelEvents) el.addEventListener(event, labels)
      labels()
      const resize = new ResizeObserver(() => current.resize())
      resize.observe(el)
      const key = (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey) || !['+', '=', '-', '_', '0'].includes(e.key)) return
        e.preventDefault()
        cancelTerrainFlight()
        if (e.key === '0') {
          current.setTerrain(null)
          setTerrain(false)
          current.fitBounds(atlas.bounds, { bearing: 0, pitch: 0, padding: 64, duration: motion() ? 600 : 0 })
        }
        else current.zoomTo(current.getZoom() + (e.key === '+' || e.key === '=' ? 0.5 : -0.5), { duration: 200 })
      }
      const keyboardTarget = compact ? el : window
      keyboardTarget.addEventListener('keydown', key as EventListener)
      return () => {
        cancelTerrainFlight()
        current.off('idle', finishTerrainFlight)
        current.off('moveend', exitDistantTerrain)
        el.removeEventListener('pointerdown', cancelTerrainFlight)
        el.removeEventListener('wheel', cancelTerrainFlight)
        el.removeEventListener('keydown', cancelTerrainFlight)
        resize.disconnect()
        current.off('move', labels)
        current.off('resize', labels)
        cancelAnimationFrame(labelFrame)
        for (const event of labelEvents) el.removeEventListener(event, labels)
        keyboardTarget.removeEventListener('keydown', key as EventListener)
        stopWaterDetail?.()
        current.remove()
        mapRef.current = null
        buttons.clear()
      }
    } catch {
      // WebGL initialization can fail synchronously; expose a retry without hiding the original image.
      // eslint-disable-next-line react/set-state-in-effect
      setFatal(true)
      stopWaterDetail?.()
      map?.remove()
      mapRef.current = null
    }
  }, [atlas, attempt, cancelTerrainFlight, t, compact, readingMap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const [id, button] of markers.current) {
      button.classList.toggle('selected', id === selected)
      button.setAttribute('aria-pressed', String(id === selected))
    }
    const place = atlas.places.find((p) => p.id === selected)
    if (place) {
      // Synchronize the external map's pending camera request with the newly selected location.
      // eslint-disable-next-line react/set-state-in-effect
      cancelTerrainFlight()
      const minimumZoom = focusPlace?.id === place.id ? RECOGNIZED_PLACE_ZOOM : 5.3
      map.flyTo({ center: place.coordinates, zoom: Math.max(map.getZoom(), map.getTerrain() ? TERRAIN_VIEW.zoom : minimumZoom), duration: motion() ? 1200 : 0 })
    }
  }, [selected, atlas, ready, cancelTerrainFlight, focusPlace])

  const exitTerrain = () => {
    cancelTerrainFlight()
    mapRef.current?.stop().setTerrain(null)
    setTerrain(false)
  }
  const region = () => {
    onSelect(null)
    exitTerrain()
    mapRef.current?.fitBounds(atlas.bounds, { bearing: 0, pitch: 0, padding: 64, duration: motion() ? 800 : 0 })
  }
  const globe = () => {
    onSelect(null)
    exitTerrain()
    mapRef.current?.easeTo({ center: atlas.center, zoom: 1.35, bearing: 0, pitch: 0, duration: motion() ? 1000 : 0 })
  }
  const toggleTerrain = () => {
    const map = mapRef.current
    if (!map) return
    if (map.getTerrain()) {
      exitTerrain()
      map.flyTo({ ...(returnView.current ?? { pitch: 0 }), duration: motion() ? 1200 : 0 })
      return
    }
    map.stop()
    returnView.current = { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
    const place = atlas.places.find((p) => p.id === selected)
    const local = map.getZoom() >= 7 || !!place
    terrainFlight.current = local ? 'detail' : 'overview'
    setTerrainLoading(true)
    setTerrain(true)
    map.setTerrain({ source: 'terrain', exaggeration: TERRAIN_VIEW.exaggeration })
    // A failed or stalled DEM must not leave a highlighted button implying completed 3D terrain.
    terrainTimer.current = setTimeout(() => {
      exitTerrain()
      setLimited(true)
      map.easeTo({ pitch: 0, duration: 0 })
    }, 15000)
    if (local) map.flyTo({
      center: map.getZoom() >= 7 ? map.getCenter() : place!.coordinates,
      zoom: Math.max(map.getZoom(), TERRAIN_VIEW.zoom), pitch: TERRAIN_VIEW.pitch, duration: motion() ? 1400 : 0,
    })
    else map.fitBounds(atlas.bounds, { bearing: 0, pitch: 0, padding: 64, maxZoom: 6, duration: motion() ? 500 : 0 })
  }

  return <>
    <div ref={container} className="atlas-map-canvas" />
    <div className="atlas-map-caption"><span>{terrain ? t("3D 地形视图") : t("地球视图")}</span><strong>{atlas.title}</strong></div>
    {(!ready || fatal) && <div className="atlas-map-status" role="status"><span className="atlas-orbit" aria-hidden>◎</span><p>{fatal ? t("地球暂时未能加载，原图仍可查看。") : t("正在展开地球…")}</p>{fatal && <button onClick={() => { setFatal(false); setReady(false); setLimited(false); setTerrain(false); setAttempt((v) => v + 1) }}>{t("重新加载")}</button>}</div>}
    {waterLimited && !limited && !fatal && <div className="atlas-map-notice" role="status">{t("详细水系暂不可用，已保留主要河流。")}</div>}
    {limited && !fatal && <div className="atlas-map-notice" role="status">{t("部分地形细节暂不可用，已保留基础地图。")}</div>}
    <nav className="atlas-map-controls" aria-label={t("地图视角")}>
      <button disabled={!ready || fatal} onClick={region}>{t("↗ 区域全览")}</button>
      <button disabled={!ready || fatal} onClick={globe}>{t("◎ 全球")}</button>
      <button disabled={!ready || fatal} onClick={toggleTerrain} aria-pressed={terrain} aria-busy={terrainLoading}>{t("△ 3D 地形")}</button>
    </nav>
    <div className="atlas-gesture-hint" role="status">{terrainLoading ? t("正在加载三维地形…") : terrain ? t("拖动探索 · 滚动缩放 · 右键拖动旋转") : t("拖动探索 · 滚动缩放")}</div>
  </>
}
