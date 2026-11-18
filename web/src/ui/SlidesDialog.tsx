import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SlidesState } from '../../../shared/slides'
import { api, jsonBody } from '../api/http'
import type { ReaderScene } from '../engine/scene'
import { t } from '../i18n'
import { Icon } from './icons'
import './slides.css'
const pending = new Map<string, Promise<SlidesState>>()
function start(path: string, target: string, retry: boolean) {
  const key = path + ':' + target
  const existing = pending.get(key)
  if (existing) return existing
  const request = api<SlidesState>(path, { method: 'POST', body: jsonBody({ target, retry }) })
  pending.set(key, request)
  void request.finally(() => pending.delete(key)).catch(() => undefined)
  return request
}
export function SlidesDialog({ bookId, target, title, scene, onClose, onReady }: {
  bookId: string; target: string; title: string; scene: ReaderScene | null; onClose: () => void; onReady: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const readyCallback = useRef(onReady)
  useLayoutEffect(() => { readyCallback.current = onReady }, [onReady])
  const [state, setState] = useState<SlidesState>({ status: 'running' })
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState({ n: 0, retry: false })
  const [page, setPage] = useState(0)
  const [full, setFull] = useState(false)
  const article = useRef<HTMLElement>(null)
  const result = state.result, slide = result?.slides[page]
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null, el = dialog.current!, previousFullscreen = document.fullscreenElement
    scene?.suspendInteraction(true); el.showModal()
    const changed = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', changed); changed()
    return () => { document.removeEventListener('fullscreenchange', changed); if (document.fullscreenElement && document.fullscreenElement !== previousFullscreen) void document.exitFullscreen().catch(() => undefined); el.close(); scene?.suspendInteraction(false); previous?.focus({ preventScroll: true }) }
  }, [scene])
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined
    const path = `/books/${encodeURIComponent(bookId)}/slides`
    const check = async (first: boolean) => {
      try {
        let next = await api<SlidesState>(`${path}?target=${encodeURIComponent(target)}`)
        if (cancelled) return
        if (first && (next.status === 'missing' || next.status === 'failed' && attempt.retry)) next = await start(path, target, attempt.retry)
        if (cancelled) return
        setState(next); setError('')
        if (next.status === 'ready') readyCallback.current()
        if (next.status === 'running') timer = setTimeout(() => void check(false), 3000)
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : t('无法读取幻灯片，请稍后重试。')) }
    }
    void check(true)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [bookId, target, attempt])
  useLayoutEffect(() => { article.current?.scrollTo(0, 0) }, [page])
  const move = (delta: number) => setPage(p => Math.max(0, Math.min((result?.slides.length ?? 1) - 1, p + delta)))
  return <dialog ref={dialog} className="slides-dialog" data-ui aria-labelledby="slides-title"
    onCancel={e => { e.preventDefault(); onClose() }} onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
    onKeyDown={e => {
      e.stopPropagation()
      if (!result || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement).matches('input,textarea,select')) return
      if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        if (e.key === 'Home') setPage(0)
        else if (e.key === 'End') setPage(result.slides.length - 1)
        else move(e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : -1)
      }
    }}>
    <header className="slides-header"><div><span className="slides-brand">{'INFINITE · '}{t('章节幻灯片')}</span><h2 id="slides-title">{title}</h2></div>
      <div className="slides-tools">
        {result && document.fullscreenEnabled && <button className="ib" aria-label={full ? t('退出全屏') : t('全屏演示')} title={full ? t('退出全屏') : t('全屏演示')} onClick={() => {
          const request = full ? document.exitFullscreen() : document.documentElement.requestFullscreen()
          void request.catch(() => setError(t('无法进入全屏，仍可在此窗口查看。')))
        }}><Icon.fit /></button>}
        <button className="ib" aria-label={t('关闭幻灯片')} title={t('关闭幻灯片')} onClick={onClose}><Icon.close /></button>
      </div>
    </header>
    {result && slide ? <>
      <div className="slides-workspace">
        <nav className="slides-outline" aria-label={t('幻灯片目录')}>{result.slides.map((s, i) =>
          <button key={i} className={i === page ? 'active' : ''} aria-current={i === page ? 'step' : undefined} onClick={() => setPage(i)}><span>{String(i + 1).padStart(2, '0')}</span><b>{s.title}</b></button>)}</nav>
        <div className="slides-stage"><article ref={article} className={`chapter-slide layout-${slide.layout}`} aria-label={t('第 {0} 页，共 {1} 页', page + 1, result.slides.length)} tabIndex={0}>
          <div className="slide-topline"><span>{t('章节精要')}</span><span>{String(page + 1).padStart(2, '0')} / {String(result.slides.length).padStart(2, '0')}</span></div>
          <h3>{slide.title}</h3><p className="slide-takeaway">{slide.takeaway}</p>
          <div className="slide-items">{slide.items.map((item, i) => <section key={i} className="slide-item"><span className="slide-item-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><div><h4>{item.heading}</h4><p>{item.text}</p></div></section>)}</div>
          <div className="slide-imprint">INFINITE READER</div>
        </article></div>
      </div>
      <footer className="slides-footer"><span className="slides-saved">{t('已保存 · 再次打开无需生成')}</span>
        <div className="slides-paging"><button className="ib" aria-label={t('上一张幻灯片')} disabled={page === 0} onClick={() => move(-1)}><Icon.left /></button>
          <span aria-live="polite">{page + 1} / {result.slides.length}</span>
          <button className="ib" aria-label={t('下一张幻灯片')} disabled={page === result.slides.length - 1} onClick={() => move(1)}><Icon.right /></button></div>
        <span className="slides-disclaimer">{t('AI 整理，请结合原文阅读。')}</span></footer>
      {error && <p className="slides-alert" role="alert">{error}</p>}
    </> : <div className="slides-status" role="status"><Icon.slides size={36} />
      <h3>{state.status === 'running' && !error ? t('正在将这一章整理为幻灯片…') : t('幻灯片暂未就绪')}</h3>
      {state.status === 'running' && !error && <><p>{t('根据章节内容生成 1–10 页，完成后自动保存。可以关闭窗口，稍后回来查看。')}</p>
        {!!state.total && <><progress value={state.completed ?? 0} max={state.total} /><small>{t('已完成 {0} / {1} 个步骤', state.completed ?? 0, state.total)}</small></>}</>}
      {error && <p role="alert">{error}</p>}
      {state.status === 'failed' && <p>{state.errorCode === 'slides_not_chapter' ? t('此目录项不是章，暂不提供幻灯片。') : t('生成未完成。已完成的步骤会保留，手动重试可能产生新的费用。')}</p>}
      {state.status === 'interrupted' && <p>{t('生成状态待确认，为避免重复生成，请稍后检查保存状态。')}</p>}
      {(error || state.status === 'interrupted') && <button className="btn" onClick={() => { setError(''); setAttempt(a => ({ n: a.n + 1, retry: false })) }}>{t('检查保存状态')}</button>}
      {state.status === 'failed' && state.errorCode !== 'slides_not_chapter' && <button className="btn" onClick={() => { setError(''); setState({ status: 'running' }); setAttempt(a => ({ n: a.n + 1, retry: true })) }}>{t('重试未完成的步骤')}</button>}
    </div>}
  </dialog>
}
