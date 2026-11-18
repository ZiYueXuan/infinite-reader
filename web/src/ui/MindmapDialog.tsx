import { useReader } from '../store/useReader'
import { MindmapConnections } from './MindmapConnections'
import { MindmapThemePicker } from './MindmapThemePicker'
import { mindmapThemeStyle, useMindmapTheme } from './mindmapThemes'
import { t } from '../i18n'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { isAnnotationMindmap } from '../../../shared/mindmap'
import type { MindmapNode, MindmapState } from '../../../shared/mindmap'
import { api, jsonBody } from '../api/http'
import { notifyMindmapSaved } from '../api/mindmaps'
import type { ReaderScene } from '../engine/scene'
import { Icon } from './icons'
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM, useMindmapCanvas } from './useMindmapCanvas'
import './mindmap.css'

// Keep the original request alive on close and coalesce Strict Mode / rapid reopens.
const pending = new Map<string, Promise<MindmapState>>()
function generate(path: string, bookId: string, target: string, retry: boolean) {
  const key = path + ':' + target
  const existing = pending.get(key)
  if (existing) return existing
  const request = api<MindmapState>(path, { method: 'POST', body: jsonBody({ target, retry }) }).then(value => {
    if (value.status === 'ready') notifyMindmapSaved(bookId, target)
    return value
  })
  pending.set(key, request)
  void request.finally(() => pending.delete(key)).catch(() => undefined)
  return request
}

function branchPaths(node: MindmapNode, path = 'root'): string[] {
  return node.children.length ? [path, ...node.children.flatMap((child, i) => branchPaths(child, `${path}.${i}`))] : []
}

function Branch({ node, path = 'root', collapsedPaths, onToggle }: {
  node: MindmapNode; path?: string; collapsedPaths: Set<string>; onToggle: (path: string) => void
}) {
  const root = path === 'root', collapsed = collapsedPaths.has(path)
  const depth = path.split('.').length - 1, branch = Number(path.split('.')[1]) % 6
  return <li className={root ? 'mindmap-root' : undefined} data-depth={depth} style={root ? undefined : { '--branch': `var(--map-branch-${branch})` } as CSSProperties}>
    <button className="mindmap-node" data-node-path={path} type="button" aria-disabled={!node.children.length} tabIndex={node.children.length ? 0 : -1}
      aria-expanded={node.children.length ? !collapsed : undefined}
      aria-label={node.children.length ? t("{0}，{1} 个子节点，点击{2}", node.text, node.children.length, collapsed ? t('展开') : t('折叠')) : undefined}
      onClick={() => { if (node.children.length) onToggle(path) }}>
      {node.text}{node.children.length > 0 && <span className="mindmap-count" aria-hidden="true">{node.children.length}</span>}
    </button>
    {node.children.length > 0 && !collapsed && <ul>{node.children.map((child, i) => <Branch key={i} node={child} path={`${path}.${i}`} collapsedPaths={collapsedPaths} onToggle={onToggle} />)}</ul>}
  </li>
}

export function MindmapDialog({ bookId, target, title, scene, onClose }: {
  bookId: string; target: string; title: string; scene: ReaderScene | null; onClose: () => void
}) {
  const canSeeCosts = useReader(s => s.session.status === 'user' && s.session.user.can_view_cost_debug)
  const dialog = useRef<HTMLDialogElement>(null)
  const { theme, setTheme } = useMindmapTheme()
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
  const [state, setState] = useState<MindmapState>({ status: 'running' })
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState({ n: 0, retry: false })
  const { viewport, content, zoom, zoomAt, reset, fit } = useMindmapCanvas(!!state.result)
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    scene?.suspendInteraction(true)
    el.showModal()
    return () => { el.close(); scene?.suspendInteraction(false); previous?.focus({ preventScroll: true }) }
  }, [scene])
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const path = `/books/${encodeURIComponent(bookId)}/mindmap`
    const check = async (first: boolean) => {
      try {
        let value = await api<MindmapState>(path + '?target=' + encodeURIComponent(target))
        if (cancelled) return
        if (first && (value.status === 'missing' || value.status === 'failed' && attempt.retry)) {
          value = await generate(path, bookId, target, attempt.retry)
        }
        if (cancelled) return
        setState(value)
        if (value.status === 'ready') notifyMindmapSaved(bookId, target)
        setError('')
        if (value.status === 'running') timer = setTimeout(() => void check(false), 2500)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : t("暂时无法连接，请稍后查看。"))
        // Read back the durable state. Never silently retry a paid request after an error.
        try {
          const value = await api<MindmapState>(path + '?target=' + encodeURIComponent(target))
          if (!cancelled) {
            setState(value)
            if (value.status === 'ready') { setError(''); notifyMindmapSaved(bookId, target) }
            if (value.status === 'running') timer = setTimeout(() => void check(false), 2500)
          }
        } catch { /* retain actionable connection error */ }
      }
    }
    void check(true)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [bookId, target, attempt])
  const result = state.result
  const toggleBranch = (path: string) => setCollapsedPaths(previous => {
    const next = new Set(previous)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const toggleAll = (collapse: boolean) => {
    setCollapsedPaths(new Set(collapse && result ? branchPaths(result.tree) : []))
    requestAnimationFrame(fit)
  }
  return <dialog ref={dialog} className="mindmap-dialog" data-map-theme={theme.id} style={mindmapThemeStyle(theme)} aria-labelledby="mindmap-title" data-ui
    onCancel={e => { e.preventDefault(); onClose() }} onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header><div><span className="mindmap-eyebrow">{t("Infinite · 思维导图")}</span><h2 id="mindmap-title">{title}</h2></div>
      <button className="ib" title={t("关闭思维导图")} aria-label={t("关闭思维导图")} onClick={onClose}><Icon.close /></button></header>
    <div className="mindmap-toolbar">
      <span role="status">{state.status === 'ready' ? state.cached ? t("已读取保存的导图 · 无新增 AI 调用") : t("已生成并自动保存") : t("首次生成后自动保存，下次直接打开")}</span>
      <div className="mindmap-actions">
        <MindmapThemePicker value={theme.id} onChange={setTheme} />
        {result && <>
        <div className="mindmap-bulk" role="group" aria-label={t("展开与折叠所有节点")}>
          <button className="btn" title={t("展开所有层级的节点")} onClick={() => toggleAll(false)}>{t("全展开")}</button>
          <button className="btn" title={t("折叠所有层级的节点")} onClick={() => toggleAll(true)}>{t("全折叠")}</button>
        </div>
        <button className="ib" aria-label={t("缩小导图")} disabled={zoom <= MIN_MAP_ZOOM} onClick={() => zoomAt(zoom / 1.1)}><Icon.minus /></button>
        <button className="btn mindmap-zoom" onClick={reset} title={t("重置位置与缩放")}>{Math.round(zoom * 100)}%</button>
        <button className="ib" aria-label={t("放大导图")} disabled={zoom >= MAX_MAP_ZOOM} onClick={() => zoomAt(zoom * 1.1)}><Icon.plus /></button>
        <button className="btn mindmap-fit" onClick={fit} title={t("调整导图位置与缩放以适应画布")}>{t("适应")}</button></>}
      </div>
    </div>
    {result?.source && <details className="mindmap-source"><summary>{t("划线原文")}</summary><blockquote>{result.source.quote}</blockquote></details>}
    {result ? <div ref={viewport} className="mindmap-viewport" tabIndex={0} aria-label={t("思维导图：拖拽或触控板双指扫动平移，捏合或 Ctrl/⌘ + 滚轮缩放；方向键平移，加减键缩放，0 重置")}>
      <div ref={content} className="mindmap-tree"><MindmapConnections content={content} layoutKey={collapsedPaths} /><ul className="mindmap-nodes"><Branch node={result.tree} collapsedPaths={collapsedPaths} onToggle={toggleBranch} /></ul></div>
    </div> : <div className="mindmap-message" aria-live="polite">
      <Icon.mindmap size={36} />
      {error && <p role="alert">{t(error)}</p>}
      {state.status === 'running' && !error && <><h3>{isAnnotationMindmap(target) ? t("正在梳理划线内容…") : t("正在梳理章节脉络…")}</h3><p>{t("再次点击不会重复生成。你可以关闭窗口，稍后回来查看。")}</p></>}
      {state.message && <p>{t(state.message)}</p>}
      {(error || state.status === 'interrupted') && <button className="btn" onClick={() => { setError(''); setAttempt(a => ({ n: a.n + 1, retry: false })) }}>{t("检查保存状态")}</button>}
      {state.status === 'failed' && <button className="btn" onClick={() => { setError(''); setState({ status: 'running' }); setAttempt(a => ({ n: a.n + 1, retry: true })) }}>{t("重新生成（可能产生费用）")}</button>}
    </div>}
    <footer>{result ? t("拖拽／双指扫动平移 · 捏合／Ctrl + 滚轮缩放 · 点击节点展开／折叠。AI 整理，请结合原文阅读。") : canSeeCosts ? t("生成所用 token 及费用会计入费用窗口。") : t("Generated results are saved for later.")}</footer>
  </dialog>
}
