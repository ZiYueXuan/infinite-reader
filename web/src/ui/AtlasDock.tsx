import { excludeTextPlaces, mergeTextMaps, type TextAtlasResult } from '../../../shared/textAtlas'
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType, type Ref } from 'react'
import { useT } from '../i18n'
import { useReader } from '../store/useReader'
import { savedBookAtlas } from '../api/atlas'
import { locateSavedMaps, mergeLocatedMaps, type LocatedMap } from '../atlas/savedMaps'
import type { AtlasSelection } from './AtlasDialog'
import type { AtlasMapProps } from './AtlasMap'
import { Icon } from './icons'
import { TextAtlasPlaces } from './TextAtlasPlaces'
import './atlas.css'

export interface AtlasDockHandle { presentTextResult: (result: TextAtlasResult) => boolean }

export function AtlasDock({ bookId, book, canRecognize, recent, recentTextMaps, excludedPlaceIds, dockRef, onPlaceDeleted }: Omit<AtlasSelection, 'map' | 'path'> & {
  recent?: LocatedMap[]
  recentTextMaps?: TextAtlasResult[]
  excludedPlaceIds?: string[]
  dockRef: Ref<AtlasDockHandle>
  onPlaceDeleted: (id: string) => void
}) {
  const t = useT()
  const [saved, setSaved] = useState<LocatedMap[]>([])
  const [savedText, setSavedText] = useState<TextAtlasResult[]>([])
  const [savedExcluded, setSavedExcluded] = useState<string[]>([])
  const textMap = useMemo(() => mergeTextMaps([...savedText, ...(recentTextMaps ?? [])], [...savedExcluded, ...(excludedPlaceIds ?? [])]), [savedText, recentTextMaps, savedExcluded, excludedPlaceIds])
  const entries = useMemo(() => mergeLocatedMaps(saved, recent ?? []), [saved, recent])
  const [view, setView] = useState<'closed' | 'list' | 'text' | LocatedMap>('closed')
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [focusPlace, setFocusPlace] = useState<AtlasMapProps['focusPlace']>()
  const [MapView, setMapView] = useState<ComponentType<AtlasMapProps> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const imageTrigger = useRef<HTMLButtonElement>(null)
  const textTrigger = useRef<HTMLButtonElement>(null)
  const pane = useRef<HTMLElement>(null)
  const loading = useReader(s => s.loading)
  const phoneControls = useReader(s => s.phoneControls)
  useImperativeHandle(dockRef, () => ({ presentTextResult(result) {
    const visible = excludeTextPlaces(result, [...savedExcluded, ...(excludedPlaceIds ?? [])])
    if (!visible.map?.places.length) return false
    const knownIds = new Set(textMap?.map?.places.map(place => place.id))
    const target = visible.map.places.find(place => !knownIds.has(place.id)) ?? visible.map.places[0]
    if (view === 'closed') setExpanded(true)
    setSelected(target.id); setFocusPlace({ id: target.id, coordinates: target.coordinates }); setView('text')
    return true
  } }), [view, savedExcluded, excludedPlaceIds, textMap])

  useEffect(() => {
    if (!canRecognize) return
    const controller = new AbortController()
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const { maps, textMaps, excludedPlaceIds } = await savedBookAtlas(bookId, controller.signal)
        if (!controller.signal.aborted) { setSavedText(textMaps); setSavedExcluded(excludedPlaceIds) }
        const found = await locateSavedMaps(book, maps, controller.signal)
        if (!controller.signal.aborted) setSaved(found)
      } catch (error) {
        if (!controller.signal.aborted) console.warn('Saved atlas list unavailable', error)
      } finally { inFlight = false }
    }
    void load()
    // A temporary network failure can recover without reopening the book.
    window.addEventListener('online', load)
    window.addEventListener('focus', load)
    return () => { controller.abort(); window.removeEventListener('online', load); window.removeEventListener('focus', load) }
  }, [bookId, book, canRecognize])

  const imageView = typeof view === 'object' ? view : null
  const activeMap = imageView?.map ?? (view === 'text' ? textMap?.map : null)
  const mini = !!activeMap
  useEffect(() => {
    if (!mini) return
    let active = true
    import('./AtlasMap').then(mod => { if (active) setMapView(() => mod.default) })
      .catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [mini])

  useEffect(() => {
    if (view !== 'closed') pane.current?.focus({ preventScroll: true })
  }, [view])

  const close = () => { setView('closed'); setExpanded(false); setFocusPlace(undefined); (view === 'text' ? textTrigger : imageTrigger).current?.focus({ preventScroll: true }) }
  const selectMapPlace = (id: string | null) => {
    setSelected(id)
    if (id === null || view !== 'text' || !expanded) return
    const entry = pane.current?.querySelector(`[data-text-place-id="${CSS.escape(id)}"]`)
    entry?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }
  const anchorLabel = (entry: LocatedMap) => {
    const pagination = useReader.getState().scene?.pagination
    const chapter = book.chapters[entry.chapter]
    const page = pagination?.pageForOffset(entry.chapter, chapter.blocks[entry.block].start)
    const label = page !== undefined ? pagination?.pages[page]?.label : undefined
    return `${chapter.title || t('Section {0}', entry.chapter + 1)}${label ? ` · ${t('第 {0} 页', label)}` : ''}`
  }
  const jump = (entry: LocatedMap) => {
    useReader.getState().goToToc(entry.chapter, entry.block)
    close()
  }
  if (!entries.length && !textMap) return null
  return <div className="atlas-dock" data-ui data-atlas-dock data-reader-controls={phoneControls} data-open={view !== 'closed'} onKeyDown={event => {
    // Let the reader's existing queued-turn handler own left/right, including repeats.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return
    if (event.target instanceof Element && event.target.closest('dialog')) { event.stopPropagation(); return }
    if (event.key === 'Escape') { event.preventDefault(); close() }
    event.stopPropagation()
  }}>
    {view !== 'closed' && <section ref={pane} tabIndex={-1} className={'atlas-dock-panel' + (mini ? ' atlas-dock-mini' : '') + (expanded && mini ? ' atlas-dock-expanded' : '')} aria-label={t('已识别的地图')}>
      <header>
        {imageView && <button onClick={() => { setView('list'); setExpanded(false); setFocusPlace(undefined) }} aria-label={t('返回地图列表')}>←</button>}
        <strong>{mini ? (view === 'text' ? t('文字地点汇总') : activeMap.title) : t('已识别的地图')}</strong>
        {mini && <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={t(expanded ? '缩小地图' : '放大地图')} title={t(expanded ? '缩小地图' : '放大地图')}>{expanded ? <Icon.shrink /> : <Icon.fit />}</button>}
        <button onClick={close} aria-label={t('收起地图')} title={t('收起地图')}>×</button>
      </header>
      {mini ? <>
        <div className="atlas-dock-body">
          {expanded && <aside className="atlas-reference text-atlas-reference">
            {view === 'text' && textMap?.map ? <TextAtlasPlaces bookId={bookId} places={textMap.map.places} selected={selected} onSelect={setSelected} onDeleted={id => {
              setSavedExcluded(ids => [...new Set([...ids, id])]); setSelected(null); setFocusPlace(undefined); onPlaceDeleted(id)
              if (textMap.map!.places.length === 1) close()
            }} /> : <div className="atlas-places">{activeMap!.places.map(place => <button key={place.id} aria-pressed={selected === place.id} onClick={() => setSelected(place.id)}>{place.name}</button>)}</div>}
          </aside>}
        <div className="atlas-viewport">
          {MapView ? <MapView key={activeMap!.id} atlas={activeMap!} selected={selected} onSelect={selectMapPlace} compact readingMap={view === 'text'} focusPlace={view === 'text' ? focusPlace : undefined} />
            : <div className="atlas-map-status" role="status"><p>{loadError ? t('地球组件加载失败。请刷新页面后重新打开地图，已保存的识别结果会保留。') : t('正在展开地球…')}</p>{loadError && <button onClick={() => location.reload()}>{t('刷新页面')}</button>}</div>}
        </div>
        </div>
        <footer>{imageView ? <button disabled={!!loading} onClick={() => jump(imageView)} title={anchorLabel(imageView)}>{t('返回地图原文')} <span>{anchorLabel(imageView)}</span> ↗</button>
          : <span>{t('本书文字识别的 {0} 个地点', activeMap!.places.length)}</span>}</footer>
      </> : <ul>{entries.map(entry => <li key={`${entry.chapter}:${entry.block}`}>
        <button className="atlas-dock-map-item" onClick={() => { setSelected(null); setView(entry) }}><span aria-hidden>◎</span><span><strong>{entry.map.title}</strong><small>{entry.map.period || t('地球视图')}</small></span><span aria-hidden>↗</span></button>
        <button className="atlas-dock-anchor" disabled={!!loading} onClick={() => jump(entry)} title={t('返回地图原文')}>{anchorLabel(entry)} ↗</button>
      </li>)}</ul>}
    </section>}
    <div className="atlas-dock-launcher" role="group" aria-label={t('已识别的地图')}>
      <button ref={imageTrigger} className="atlas-dock-trigger" data-image-atlas disabled={!entries.length}
        aria-label={t('图片地图')} title={t(entries.length ? '图片地图' : '暂无已识别的图片地图')}
        aria-expanded={view === 'list' || !!imageView} onClick={() => {
          if (view === 'list' || imageView) close()
          else { setView('list'); setExpanded(false); setSelected(null); setFocusPlace(undefined) }
        }}><Icon.foldedMap size={21} /></button>
      <span className="atlas-dock-divider" aria-hidden />
      <button ref={textTrigger} className="atlas-dock-trigger" data-text-atlas disabled={!textMap}
        aria-label={t('文字地点')} title={t(textMap ? '文字地点' : '暂无已识别的文字地点')}
        aria-expanded={view === 'text'} onClick={() => {
          if (view === 'text') close()
          else { setView('text'); setExpanded(false); setSelected(null); setFocusPlace(undefined) }
        }}><Icon.textPin size={21} /></button>
    </div>
  </div>
}
