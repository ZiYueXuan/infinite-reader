import { t, getLocale } from '../i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BookBibliography, MetadataSource, MetadataValue } from '../../../shared/bibliography'
import type { BookMeta } from '../book/types'
import { api, ApiError } from '../api/http'
import { Icon } from './icons'
import './book-info.css'

type Result = { bibliography: BookBibliography | null; attemptedAt: number | null; error: string | null; status: 'ready' | 'pending' | 'failed' | 'not_extracted' }
const dateTypes: Record<string, string> = { publication: '出版日期', creation: '创建日期', modification: '文件修改日期', unspecified: '日期（类型未注明）', 'dcterms:issued': '发行日期', 'dcterms:created': '创建日期', 'dcterms:modified': '文件修改日期' }
const role = (r: string) => r.toLowerCase().split(/[/:#]/).at(-1)
const isRole = (roles: string[], names: string[]) => roles.some(r => names.includes(role(r) ?? ''))
const timestamp = (n: number) => new Date(n).toLocaleString(getLocale(), { hour12: false })

function Source({ source }: { source: MetadataSource }) {
  return <small className="book-info-source" title={`${source.path} · ${source.field}`}>{source.kind === 'copyright-page' ? t("版权页") : t("文件元数据")}</small>
}
function Values({ label, values }: { label: string; values: MetadataValue[] }) {
  return <div className="book-info-row"><dt>{t(label)}</dt><dd>{values.length ? values.map((v, i) => <div key={i}>{v.value} <Source source={v.source} /></div>) : <span className="book-info-muted">{t("未提供")}</span>}</dd></div>
}

export function BookInfoDialog({ book, cloud, anchor, onClose }: {
  book: BookMeta; cloud: boolean; anchor: HTMLButtonElement; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(cloud)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState({ method: 'GET', sequence: 0 })
  const [waiting, setWaiting] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)

  useLayoutEffect(() => {
    const el = dialog.current!
    el.showModal()
    close.current?.focus({ preventScroll: true })
    return () => { el.close(); if (anchor.isConnected) anchor.focus({ preventScroll: true }) }
  }, [anchor])

  useEffect(() => {
    if (!cloud) return
    const controller = new AbortController()
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, polls = 0
    const path = `/books/${encodeURIComponent(book.id)}/metadata`
    const read = async (method = 'GET') => {
      try {
        if (method === 'POST') await api(path, { method, signal: controller.signal })
        const data = await api<Result>(path, { signal: controller.signal })
        if (disposed) return
        setResult(data); setBusy(false)
        if (data.status === 'pending') {
          // Bounded read-only polling; never automatically resubmit extraction.
          if (++polls < 20) timer = setTimeout(() => {
            if (document.hidden) { setWaiting(true); return }
            void read()
          }, 2000)
          else setWaiting(true)
        }
      } catch (err) {
        if (disposed) return
        setBusy(false)
        setError(err instanceof ApiError && err.status === 401 ? t("登录已失效，请重新登录后查看。") :
          err instanceof ApiError && err.status === 404 ? t("这本书已不存在，或当前账号无法访问。") :
          err instanceof ApiError && err.status === 409 ? t("书籍正在解析，请完成后再提取。") :
          err instanceof ApiError && err.status === 429 ? t("请求较频繁，请稍后再试。") : t("暂时无法读取书籍信息，请检查网络后重试。"))
      }
    }
    void read(request.method)
    return () => { disposed = true; controller.abort(); clearTimeout(timer) }
  }, [book.id, cloud, request])

  const load = (method = 'GET') => {
    if (busy) return
    if (method === 'POST' && result?.attemptedAt && Date.now() - result.attemptedAt < 300_000) {
      setError(t("上次提取尚在重试间隔内，请在 {0} 后重试。", timestamp(result.attemptedAt + 300_000)))
      return
    }
    setBusy(true)
    setError(null)
    setWaiting(false)
    setRequest(r => ({ method, sequence: r.sequence + 1 }))
  }
  const b = result?.bibliography
  const people = (names: string[], other = false): MetadataValue[] => (b?.contributors ?? [])
    .filter(c => other ? !isRole(c.roles, ['aut', 'author', 'trl', 'translator']) : isRole(c.roles, names))
    .map(c => ({ value: c.name, source: c.source }))
  const ready = !book.status || book.status === 'ready'
  const status = busy ? t("正在读取书籍信息…") : b ? t("出版信息已保存 · 提取于 {0}", timestamp(b.extractedAt)) :
    !cloud ? t("本地书籍目前仅显示基础信息。云端书籍可提取出版信息。") :
    result?.status === 'pending' ? waiting ? t("仍在后台提取，可稍后检查状态。") : t("正在后台提取出版信息…") :
    result?.status === 'failed' ? t("上次提取未完成，书籍仍可正常阅读。") :
    result ? ready ? t("尚未提取出版信息。") : t("书籍尚未就绪，请解析完成后再提取。") : ''

  return <dialog ref={dialog} className="book-info-dialog" data-ui aria-labelledby="book-info-title"
    onCancel={e => { e.preventDefault(); onClose() }} onWheel={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <header><div><span className="book-info-eyebrow">{t("书籍信息")}</span><h2 id="book-info-title">{book.title || t("Untitled")}</h2></div>
      <button ref={close} type="button" className="ib" aria-label={t("关闭书籍信息")} onClick={onClose}><Icon.close /></button></header>
    <div className="book-info-content">
      <div className="book-info-status" role="status" aria-live="polite">{status}</div>
      {error && <p className="book-info-error" role="alert">{t(error)}</p>}
      {cloud && !b && <div className="book-info-actions">
        {ready && (result?.status === 'not_extracted' || result?.status === 'failed') && <button type="button" disabled={busy} onClick={() => load('POST')}>
          {result.status === 'failed' ? t("重试提取") : t("提取出版信息")}</button>}
        <button type="button" disabled={busy} onClick={() => load()}>{error ? t("重新读取") : t("检查状态")}</button>
      </div>}
      {b ? <>
        <dl className="book-info-fields">
          <Values label={t("书名")} values={b.titles} />
          <Values label={t("作者")} values={people(['aut', 'author'])} />
          <Values label={t("译者")} values={people(['trl', 'translator'])} />
          {people([], true).length > 0 && <Values label={t("其他贡献者")} values={people([], true)} />}
          <Values label={t("出版社")} values={b.publishers} />
          <Values label={t("版次")} values={b.editions} />
          <Values label={t("语言")} values={b.languages} />
          {b.dates.length ? b.dates.map((d, i) => <Values key={i} label={dateTypes[d.type ?? 'unspecified'] ?? t("日期")} values={[d]} />) : <Values label={t("出版日期")} values={[]} />}
        </dl>
        <section className="book-info-identifiers"><h3>{t("ISBN 与其他标识")}</h3>
          {b.identifiers.length ? b.identifiers.map((id, i) => <div className="book-info-identifier" key={i}>
            <div><strong>{id.scheme || t("其他标识")}</strong><span className="book-info-muted">{id.relation === 'publication' ? t("本出版物") : id.relation === 'source' ? t("来源出版物") : t("版本关系未确定")}</span></div>
            <p>{id.normalized ?? id.raw}</p>
            {id.normalized && id.normalized !== id.raw && <small>{t("原值：")}{id.raw}</small>}
            <div><Source source={id.source} />{id.valid !== null && <span className={id.valid ? 'book-info-valid' : 'book-info-error'}>{id.valid ? t("ISBN 校验通过") : t("ISBN 校验未通过")}</span>}</div>
          </div>) : <p className="book-info-muted">{t("未找到 ISBN 或其他标识。")}</p>}
        </section>
        <dl className="book-info-fields"><Values label={t("简介")} values={b.descriptions} /><Values label={t("主题")} values={b.subjects} /><Values label={t("权利声明")} values={b.rights} /></dl>
        {b.warnings.length > 0 && <p className="book-info-warning">{b.warnings.includes('invalid_isbn') ? t("部分 ISBN 未通过校验，已保留原值。") : ''}
          {b.warnings.some(w => w.includes('truncated')) ? t("部分信息过长，提取结果已截短。") : ''}</p>}
        <p className="book-info-muted">{t("以上信息来自电子书文件，尚未通过外部书目核验；ISBN 校验通过不代表版本已确认。")}</p>
        <details className="book-info-raw" onToggle={e => setRawOpen(e.currentTarget.open)}><summary>{t("查看提取来源与原始记录")}</summary>
          {rawOpen && <pre>{JSON.stringify(b, null, 2)}</pre>}</details>
      </> : <dl className="book-info-fields"><div className="book-info-row"><dt>{t("书架作者")}</dt><dd>{book.author || t("未提供")}</dd></div></dl>}
      <dl className="book-info-fields book-info-file"><div className="book-info-row"><dt>{t("文件名")}</dt><dd>{book.filename || t("未提供")}</dd></div>
        {typeof book.size === 'number' && <div className="book-info-row"><dt>{t("文件大小")}</dt><dd>{(book.size / 1024 / 1024).toFixed(2)} MB</dd></div>}</dl>
    </div>
  </dialog>
}
