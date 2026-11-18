import { t } from '../i18n'
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import type { BookMap } from '../atlas/catalog'
import type { ParsedBook } from '../book/types'
import type { ReaderScene } from '../engine/scene'
import type { AtlasMapProps } from './AtlasMap'
import type { AtlasRecognition } from '../../../shared/atlas'
import { recognizeBookMap } from '../api/atlas'
import { ApiError } from '../api/http'
import './atlas.css'

export interface AtlasSelection { bookId: string; book: ParsedBook; path: string; map: BookMap | null; canRecognize: boolean }

export function AtlasDialog({ selection, scene, onClose, onSignIn, onRecognized }: { selection: AtlasSelection; scene: ReaderScene; onClose: () => void; onSignIn: () => void; onRecognized?: (selection: AtlasSelection, map: BookMap) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [MapView, setMapView] = useState<ComponentType<AtlasMapProps> | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [recognitionAttempt, setRecognitionAttempt] = useState(0)
  const [result, setResult] = useState<AtlasRecognition | null>(null)
  const [recognitionError, setRecognitionError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState(false)
  const { bookId, book, path, canRecognize } = selection
  const map = result?.map ?? (recognitionAttempt === 0 ? selection.map : null)
  const place = map?.places.find((p) => p.id === selected)
  const recognizing = !map && !result && !recognitionError && canRecognize
  const needsSignIn = !canRecognize || authRequired
  const title = map?.title ?? t("识别书中地图")

  useEffect(() => {
    if (map) onRecognized?.(selection, map)
  }, [map, selection, onRecognized])

  useEffect(() => {
    if ((selection.map && recognitionAttempt === 0) || !canRecognize) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)
    // Strict Mode's first setup is cancelled before it sends a paid inference request.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      try {
        const recognition = await recognizeBookMap(bookId, path, recognitionAttempt > 0, controller.signal)
        if (!controller.signal.aborted) setResult(recognition)
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) setAuthRequired(true)
        setRecognitionError(error instanceof ApiError && error.status === 429
          ? t("识别次数较多，请在 {0} 秒后重试。", error.retryAfter ?? 60)
          : error instanceof ApiError && error.status === 404 ? t("请从书架打开已上传的云端书籍后再识别。")
          : error instanceof ApiError && error.status >= 400 ? error.message : t("识别服务暂时无法连接，请稍后重试。"))
      } finally { clearTimeout(timeout) }
    })
    const onTimeout = () => setRecognitionError(t("识别等待超时，请稍后重试。"))
    controller.signal.addEventListener('abort', onTimeout)
    return () => { controller.signal.removeEventListener('abort', onTimeout); controller.abort(); clearTimeout(timeout) }
  }, [selection.map, bookId, path, canRecognize, recognitionAttempt])

  const retryRecognition = () => {
    if (result?.status === 'not_map') return
    setResult(null); setRecognitionError(null); setAuthRequired(false); setSelected(null)
    setRecognitionAttempt((n) => n + 1)
  }

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    scene.suspendInteraction(true)
    el.showModal()
    close.current?.focus()
    // A trackpad pinch must reach the map without also zooming the browser's document.
    const wheel = (e: WheelEvent) => { if ((e.ctrlKey || e.metaKey) && e.cancelable) e.preventDefault() }
    el.addEventListener('wheel', wheel, { passive: false, capture: true })
    return () => {
      el.removeEventListener('wheel', wheel, true)
      el.close()
      scene.suspendInteraction(false)
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return
        const target = previous?.isConnected && previous !== document.body
          ? previous
          : document.querySelector<HTMLElement>(`[data-book-image="${CSS.escape(path)}"]`)
        target?.focus({ preventScroll: true })
      })
    }
  }, [scene, path])

  useEffect(() => {
    if (!map) return
    let active = true
    import('./AtlasMap').then((mod) => { if (active) setMapView(() => mod.default) }).catch((error: unknown) => {
      console.error('Atlas component could not be loaded', error)
      if (active) setMapError(true)
    })
    return () => { active = false }
  }, [map])

  useEffect(() => {
    let active = true, url: string | null = null
    book.getImage(path).then((blob) => {
      if (!active) return
      if (!blob) { setImageError(true); return }
      url = URL.createObjectURL(blob)
      setImageUrl(url)
    }).catch(() => { if (active) setImageError(true) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [book, path])

  return (
    <dialog ref={dialog} className="book-atlas" data-ui aria-labelledby="atlas-title" onCancel={(e) => { e.preventDefault(); onClose() }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault()
      }}>
      <header className="atlas-header">
        <div className="atlas-heading"><span className="atlas-eyebrow">INFINITE ATLAS <i>/</i> {map?.number ? t("地图 {0}", map.number) : t("从纸上探索世界")}</span>
          <h1 id="atlas-title">{title}<span>{map?.period}</span></h1>
        </div>
        <button ref={close} className="atlas-close" onClick={onClose} aria-label={t("关闭地图，返回阅读")}><span aria-hidden>↙</span> {t("返回书页")} <kbd>Esc</kbd></button>
      </header>
      <div className={'atlas-body' + (enlarged ? ' atlas-original-expanded' : '')}>
        <aside className="atlas-reference" aria-label={t("书中原图与地点")}>
          <div className="atlas-section-heading"><span>{t("书中原图")}</span><button onClick={() => setEnlarged((v) => !v)} aria-expanded={enlarged}>{enlarged ? t("还原") : t("放大原图")} <span aria-hidden>↗</span></button></div>
          <figure className="atlas-original">
            {imageUrl && !imageError ? <div className="atlas-image-wrap"><img src={imageUrl} alt={map ? [map.number && t("地图 {0}", map.number), map.title, map.period].filter(Boolean).join('：') : t("待识别的书中原图")} onError={() => setImageError(true)} />
              {place?.imagePoint && <span className="atlas-image-pin" style={{ left: `${place.imagePoint[0] * 100}%`, top: `${place.imagePoint[1] * 100}%` }} aria-hidden />}
            </div> : <p role="status">{imageError ? t("暂时无法读取原图。关闭后可重新打开。") : t("正在读取原图…")}</p>}
            <figcaption>{map?.recognition ? t("AI 估计区域与图中标记；城市坐标来自地名库。历史边界请对照原图。") : t("自然地形提供空间参照，历史边界请对照原图。")}</figcaption>
          </figure>
          <div className="atlas-places-heading"><span>{map?.recognition ? t("已匹配的地名") : t("沿着地名阅读")}</span><span>{String(map?.places.length ?? 0).padStart(2, '0')}</span></div>
          <div className="atlas-places" aria-label={t("图中地点")}>
            {map?.places.map((p, i) => <button key={p.id} className={selected === p.id ? 'selected' : ''} aria-pressed={selected === p.id} onClick={() => setSelected(p.id)}>
              <span className="atlas-place-number">{String(i + 1).padStart(2, '0')}</span><span>{p.name}<small>{p.modernName}</small></span><span className="atlas-place-arrow" aria-hidden>↗</span>
            </button>)}
            {!map && <p className="atlas-small-note">{recognizing ? t("正在读图并匹配地名…") : t("识别成功后，这里会显示可探索的地点。")}</p>}
            {!!map?.recognition?.unresolved.length && <p className="atlas-small-note">{t("暂未匹配：")}{map.recognition.unresolved.join('、')}{t("。这些地点尚未标到地球上。")}</p>}
          </div>
        </aside>
        <section className="atlas-viewport" aria-label={t("{0}的交互地球", title)} aria-busy={recognizing}>
          {!map ? <div className="atlas-map-status atlas-recognition-status" role="status">
            <span className={'atlas-orbit' + (recognizing ? ' atlas-recognizing' : '')} aria-hidden>◎</span>
            <h2>{needsSignIn ? t("登录后，让地图走出书页") : recognizing ? t("正在读懂这张地图") : result?.status === 'not_map' ? t("未识别为地图") : t("暂时无法定位")}</h2>
            <p>{needsSignIn ? t("自动识别适用于你已上传的云端书籍。") : recognizing ? t("识别区域、读取地名，并匹配城市坐标。") : t(recognitionError ?? result?.message ?? '')}</p>
            {recognizing && <small>{t("仅识别这张原图和书名。DeepSeek 无法可靠定位时，会自动尝试 Cloudflare 上的 GLM，可能需要稍久一些。")}</small>}
            {needsSignIn ? <button onClick={onSignIn}>{t("登录")}</button> : !recognizing && result?.status !== 'not_map' && <button onClick={retryRecognition}>{t("重新识别")}</button>}
          </div> : MapView ? <MapView atlas={map} selected={selected} onSelect={setSelected} /> : <div className="atlas-map-status" role="status">
            <span className="atlas-orbit" aria-hidden>◎</span><p>{mapError ? t("地球组件加载失败。请刷新页面后重新打开地图，已保存的识别结果会保留。") : t("正在展开地球…")}</p>
            {/* Re-importing the same missing hashed URL cannot recover an older page after deployment.
                A full reload obtains the current entry/chunk graph; it never retries recognition. */}
            {mapError && <button onClick={() => window.location.reload()}>{t("刷新页面")}</button>}
          </div>}
        </section>
      </div>
      <footer className="atlas-footer"><span>{map?.recognition ? t("AI 自动识别 · 请结合原图核对") : t("从纸上的地名，到世界中的位置。")}</span>
        {map?.recognition ? <button onClick={retryRecognition}>{t("重新识别")}</button> : <span>{t("地形与城市位置参照")}{map?.period ? ` · ${map.period}` : ''}</span>}
      </footer>
    </dialog>
  )
}
