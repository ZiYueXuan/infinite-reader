import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { excludeTextPlaces, type TextAtlasResult } from '../../../shared/textAtlas'
import type { ReaderScene } from '../engine/scene'
import { api, ApiError, jsonBody } from '../api/http'
import { t, errorText, getLocale } from '../i18n'
import './atlas.css'
import './text-atlas.css'

export function TextAtlasDialog({ bookId, text, scene, onClose, excludedPlaceIds, onRecognized }: {
  bookId: string; text: string; scene: ReaderScene | null; onClose: () => void
  excludedPlaceIds?: string[]; onRecognized: (result: TextAtlasResult, present: boolean) => boolean | void
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null)
  const active = useRef(true), busy = useRef(false)
  const [stage, setStage] = useState<'confirm' | 'loading' | 'result' | 'error'>('confirm')
  const [retry, setRetry] = useState(false)
  const [result, setResult] = useState<TextAtlasResult | null>(null)
  const [error, setError] = useState('')
  const [limited, setLimited] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [retrySeconds, setRetrySeconds] = useState(0)
  useEffect(() => {
    const update = () => setRetrySeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))
    update()
    if (!retryAt) return
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [retryAt])
  const displayed = useMemo(() => result ? excludeTextPlaces(result, excludedPlaceIds ?? []) : null, [result, excludedPlaceIds])
  const close = () => {
    if (result) onRecognized(result, false)
    onClose()
  }
  const viewMap = () => {
    if (result && onRecognized(result, true)) onClose()
    else setError(t('地图暂不可用，请返回书页后重试。'))
  }
  useEffect(() => {
    if (stage === 'result') dialog.current?.querySelector<HTMLElement>('.text-atlas-review-heading')?.focus()
  }, [stage])
  useLayoutEffect(() => {
    active.current = true
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    scene?.suspendInteraction(true)
    element.showModal()
    cancel.current?.focus()
    return () => { active.current = false; element.close(); scene?.suspendInteraction(false); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [scene])
  // No effects, prefetch or opening gesture can dispatch a paid request.
  const confirm = async () => {
    if (busy.current) return
    busy.current = true
    setStage('loading'); setError(''); setLimited(false); setRetryAt(0)
    try {
      const response = await api<TextAtlasResult>(`/books/${encodeURIComponent(bookId)}/text-atlas`, {
        method: 'POST', body: jsonBody({ text, confirmed: true, retry }), signal: AbortSignal.timeout(90_000),
      })
      if (active.current) { setResult(response); setStage('result') }
      else onRecognized(response, false)
    } catch (e) {
      if (active.current) {
        setError(e instanceof Error ? e.message : t('地图生成失败，请稍后重试。'))
        const isLimited = e instanceof ApiError && e.status === 429
        setLimited(isLimited)
        if (isLimited && Number.isFinite(e.retryAfter) && e.retryAfter! > 0) {
          setRetryAt(Date.now() + e.retryAfter! * 1000); setRetrySeconds(Math.ceil(e.retryAfter!))
        }
        setStage('error')
      }
    } finally { busy.current = false }
  }
  const map = displayed?.map
  const regionNames = new Intl.DisplayNames([getLocale()], { type: 'region' })
  return <dialog ref={dialog} className="book-atlas text-atlas text-atlas-prompt" data-ui aria-labelledby="text-atlas-title"
    onCancel={e => { e.preventDefault(); close() }} onClick={e => {
      if (e.target !== e.currentTarget) return
      const r = e.currentTarget.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close()
    }}>
    <header className="atlas-header"><div className="atlas-heading"><span className="atlas-eyebrow">INFINITE ATLAS</span>
      <h1 id="text-atlas-title">{t(stage === 'confirm' ? '生成阅读地图？' : stage === 'result' ? '地点识别结果' : '阅读地图')}</h1></div>
      <button ref={cancel} className="atlas-close" onClick={close} aria-label={t('关闭地图，返回阅读')}>×</button></header>
    {!map ? <div className="text-atlas-consent">
      {stage === 'confirm' && <>
        <p>{t('将把所选文字和书名发送给 AI，解析地名并生成阅读地图，会消耗 token。是否继续？')}</p>
        <blockquote>{text}</blockquote>
        <small>{t('仅在确认后开始。已有结果会直接复用；取消不会发起 AI 请求。')}</small>
        <div className="text-atlas-actions"><button onClick={close}>{t('取消')}</button><button className="text-atlas-primary" onClick={() => void confirm()}>{t('确认生成')}</button></div>
      </>}
      {stage === 'loading' && <div role="status"><h2>{t('正在生成阅读地图…')}</h2><p>{t('正在解析地名并查询坐标库。关闭窗口不会撤销已开始的 token 消耗，请勿重复生成。')}</p></div>}
      {stage === 'error' && <><p role="alert">{errorText(error)}</p>
        <small>{t(limited ? '本次请求未开始 AI 识别，不消耗 token。已有地图仍可查看。' : '本次尝试可能已消耗 token。重试需要再次确认。')}</small>
        {limited && retryAt > 0 && <p>{t('可重试时间（设备当地时间）：{0}', new Date(retryAt).toLocaleString())}</p>}
        <div className="text-atlas-actions"><button onClick={close}>{t('返回书页')}</button><button disabled={limited && retrySeconds > 0} onClick={() => { setRetry(true); setStage('confirm') }}>{t(limited && retrySeconds > 0 ? retrySeconds > 60 ? '等待额度恢复' : '等待 {0} 秒后重试' : '重新尝试', retrySeconds)}</button></div></>}
      {stage === 'result' && result?.status === 'ready' && !map ? <><h2>{t('暂无可显示的文字地点')}</h2><p>{t('已删除的地点不会再出现在本书文字地图中。')}</p><button onClick={close}>{t('返回书页')}</button></> : stage === 'result' && <><h2>{t('暂未可靠定位')}</h2><p>{t('所选文字中暂未找到能可靠匹配坐标的地点，不会绘制猜测位置。')}</p>{!!result?.unresolved.length && <p>{result.unresolved.join('、')}</p>}<button onClick={close}>{t('返回书页')}</button></>}
    </div> : <div className="text-atlas-consent text-atlas-review">
      <h2 className="text-atlas-review-heading" tabIndex={-1}>{t('已定位 {0} 个地点', map.places.length)}</h2>
      <p>{t('请核对本次匹配结果，再前往地图查看。')}</p>
      <ol className="text-atlas-review-list">{map.places.map(place => <li key={place.id}>
        <strong>{place.name}</strong>
        <span>{t('匹配名称：{0}', place.modernName)}</span>
        <span>{place.countryCode && /^[A-Z]{2}$/.test(place.countryCode) ? `${regionNames.of(place.countryCode)} · ` : ''}{t('坐标：{0}', `${place.coordinates[1].toFixed(4)}, ${place.coordinates[0].toFixed(4)}`)}</span>
        {place.historicalAlias && <small>{t('历史别名；标注为地名库中的对应位置')}</small>}
        <a href={place.sourceUrl} target="_blank" rel="noreferrer">{place.source} · {t('查看来源')}</a>
      </li>)}</ol>
      {!!displayed!.unresolved.length && <div className="text-atlas-unresolved"><strong>{t('暂未匹配：')}</strong><p>{displayed!.unresolved.join('、')}</p><small>{t('这些地点不会标注在地图上。')}</small></div>}
      <details><summary>{t('所选原文')}</summary><blockquote>{text}</blockquote></details>
      <small>{t('识别结果已保存。查看地图不会再次调用 AI，也不额外消耗 token。')}</small>
      {error && <p role="alert">{errorText(error)}</p>}
      <div className="text-atlas-actions"><button onClick={close}>{t('返回书页')}</button><button className="text-atlas-primary text-atlas-view-map" onClick={viewMap}>{t('在地图中查看')}</button></div>
    </div>}

  </dialog>
}

