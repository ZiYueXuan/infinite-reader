import { t, getLocale, errorText } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { CostItem, CostSnapshot } from '../../../shared/costs'
import { api } from '../api/http'
import { useReader } from '../store/useReader'
import './cost-debug.css'

function dollars(value: number) {
  if (value === 0) return '$0'
  if (value < .000001) return '<$0.000001'
  const fractionalMicrodollar = value < .001 && Math.abs(value * 1e6 - Math.round(value * 1e6)) > 1e-8
  return '$' + value.toFixed(fractionalMicrodollar ? 8 : value < 1 ? 6 : 4)
}
const amount = (high: number, low = high) => low < high - 1e-12 ? `${dollars(low)}–${dollars(high)}` : dollars(high)
function Timestamp({ value }: { value: number }) {
  const date = new Date(value)
  return <time dateTime={date.toISOString()} title={date.toLocaleString(getLocale(), { timeZoneName: 'long' })}>{date.toLocaleString(getLocale(), {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })}</time>
}
const status: Record<string, string> = { started: '进行中／待回报', succeeded: '完成', failed: '失败', aborted: '中断' }
function readStart(key: string) {
  try { const n = Number(sessionStorage.getItem(key)); if (n > 0 && n <= Date.now()) return n } catch { /* storage optional */ }
  return Date.now()
}
function Item({ item }: { item: CostItem }) {
  return <details className="cost-item">
    <summary><span><b>{t(item.label)}</b><small><Timestamp value={item.startedAt} /> · {t(status[item.status] ?? item.status)}</small></span><strong>{item.usd === null ? t("待计量") : amount(item.usd, item.lowUsd ?? item.usd)}{item.basis === 'unavailable' && item.usd !== null ? ' + ?' : ''}</strong></summary>
    {item.bookTitle && <p>{item.bookTitle}</p>}
    {item.model && <p>{item.model}</p>}
    <p>{t(item.reason)}</p>
    {item.search && <>
      <p>{t('已确认成功搜索：{0}；已记录发送尝试：{1}', item.search.requests ?? t('未知'), item.search.attempts ?? t('未知'))}</p>
      {item.search.billedRequests !== undefined && <p>{t('按供应商规则计费的搜索次数：{0}', item.search.billedRequests ?? t('未知'))}</p>}
      <p>{t('搜索计价版本：{0}', item.search.pricingVersion)}</p>
      {item.search.httpStatus !== null && <p>HTTP {item.search.httpStatus}</p>}
      {item.search.providerRequestId && <p>{t('供应商请求 ID：{0}', item.search.providerRequestId)}</p>}
      {item.search.errorCode && <p>{t('错误代码：{0}', item.search.errorCode)}</p>}
    </>}
    {item.parts.map(part => <div className="cost-line" key={part.label}><span>{t(part.label)}<small>{part.quantity.toLocaleString(getLocale())} {t(part.unit)}</small></span><span>{dollars(part.usd)}</span></div>)}
    <small>{t("调用")} {item.operationId}</small>
  </details>
}

interface Placement { reading?: boolean; open: boolean; onClose: () => void }
function AccountCosts({ userId, reading, open, onClose }: { userId: string } & Placement) {
  const currentBook = useReader(s => s.current?.meta.id)
  const startKey = 'ir:cost-since:' + userId
  const [since, setSince] = useState(() => readStart(startKey))
  const heading = useRef<HTMLButtonElement>(null)
  const [scope, setScope] = useState('account')
  const [feature, setFeature] = useState('')
  const book = scope === 'book' ? currentBook : undefined
  const [refresh, setRefresh] = useState(0)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [result, setResult] = useState<{ key: string; data: CostSnapshot } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const key = `${since}:${book ?? ''}:${feature}`
  const data = result?.key === key ? result.data : null
  const message = error?.key === key ? error.message : null
  useEffect(() => { try { sessionStorage.setItem(startKey, String(since)) } catch { /* optional */ } }, [startKey, since])
  useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }) }, [open])
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (!open || !visible) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const params = new URLSearchParams({ since: String(since) })
        if (book) params.set('book', book)
        if (feature) params.set('feature', feature)
        const next = await api<CostSnapshot>('/costs?' + params, { signal: controller.signal })
        if (!controller.signal.aborted) { setResult({ key, data: next }); setError(null) }
      } catch (e) {
        if (!controller.signal.aborted) setError({ key, message: e instanceof Error ? e.message : t("费用暂不可用") })
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 15_000)
      }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, visible, since, book, feature, key, refresh])
  const exportSnapshot = () => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `ereader-costs-${new Date(data.asOf).toISOString().replace(/[:.]/g, '-')}.json`
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  // Stay mounted to preserve the observation start and filters while the panel is hidden.
  if (!open) return null
  return <aside className={`cost-debug is-open ${reading ? 'cost-reading' : 'cost-shelf'}`} data-ui="true" aria-label={t("费用调试窗口")}>
    <button ref={heading} className="cost-heading" title={t("关闭并暂停刷新")} aria-expanded={open} aria-controls="cost-content" onClick={() => {
      onClose()
      document.querySelector<HTMLButtonElement>('.account .chip')?.focus({ preventScroll: true })
    }}>
      <span className="cost-dot" /> <b>{t("费用 · DEBUG")}</b><span>{data ? dollars(data.totalUsd) + (data.unknown ? ' + ?' : '') : 'USD'}</span><span aria-hidden="true">×</span>
    </button>
    {open && <div id="cost-content" className="cost-content">
      <div className="cost-actions">
        <select aria-label={t("费用范围")} value={book ? 'book' : 'account'} onChange={e => setScope(e.target.value)}><option value="account">{t("当前账户")}</option>{currentBook && <option value="book">{t("当前书籍")}</option>}</select>
        <select aria-label={t('费用类型')} value={feature} onChange={e => setFeature(e.target.value)}><option value="">{t('所有操作')}</option><option value="web_search">{t('仅外部搜索')}</option></select>
        <button onClick={() => setRefresh(n => n + 1)}>{t("刷新")}</button>
        <button onClick={() => { const today = new Date(); today.setHours(0, 0, 0, 0); setSince(today.getTime()) }}>{t("今天")}</button>
        <button onClick={() => setSince(Date.now())}>{t("重置观察")}</button>
      </div>
      <div className="cost-total"><small>{t("已知费用估算 · USD")}</small><strong>{data ? amount(data.totalUsd, data.lowUsd) : t("读取中…")}</strong><small>{t("观察起点")} {new Date(data?.since ?? since).toLocaleString(getLocale())}</small></div>
      <p className="cost-muted">{t("公开单价，未扣免费额度；不是实际账单。")}</p>
      {message && <p role="alert" className="cost-warning">{t("刷新失败：")}{errorText(message)}{data ? t("（保留上次结果）") : ''}</p>}
      {data && <>
        {(data.unknown > 0 || data.estimated > 0) && <p className="cost-warning">{data.unknown} {t("项待计量／不完整 ·")} {data.estimated} {t("项粗估／区间")}</p>}
        {data.truncated && <p className="cost-warning">{t("已截断：最多回看 31 天，每类最多 2,000 条。小计不代表完整历史。")}</p>}
        <div className="cost-list-heading"><b>{t("操作明细 ·")} {data.count} {t("项")}</b><button onClick={exportSnapshot}>{t("导出快照")}</button></div>
        <p className="cost-muted cost-order">{t("按操作开始时间由近到远 · 本地时间")}</p>
        {data.count > data.items.length && <p className="cost-muted">{t("下列及导出明细仅含最近")} {data.items.length} {t("项；小计包含上方统计的全部项目。")}</p>}
        {data.items.length ? data.items.map(item => <Item key={item.id} item={item} />) : <p className="cost-muted">{t("此观察时段暂无已记录操作。上传、问答或保存笔记后，费用会在下次刷新时显示。")}</p>}
        <details className="cost-groups"><summary>{t("分类汇总 · 最近使用在前")}</summary>
          {data.groups.map(group => <div className="cost-line" key={group.label}><span>{t(group.label)}<small>{group.count} {t("项")}{group.unknown ? t("· {0} 待计量", group.unknown) : ''}</small>
            {typeof group.latestStartedAt === 'number' && <small>{t("最近一次：")}<Timestamp value={group.latestStartedAt} /></small>}
          </span><b>{group.unknown === group.count && group.usd === 0 ? t("待计量") : dollars(group.usd)}</b></div>)}
        </details>
        <div className="cost-storage"><b>{t("原书存储 ≈")} {dollars(data.storage.usdPerMonth)}{t(' / month')}</b><small>{data.storage.books} {t("本 ·")} {(data.storage.bytes / 1e6).toFixed(2)} {t("MB；单列，不计入操作小计。")}</small></div>
        <details className="cost-coverage"><summary>{t("计量范围与价格依据")}</summary>{data.exclusions.map(text => <p key={text}>{t(text)}</p>)}<p>{t("价格核对：")}{data.pricingVersion}</p><div>{data.sources.map(source => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}</a>)}</div></details>
        <p className="cost-muted">{t("更新于")} <Timestamp value={data.asOf} /> {t("· 每 15 秒刷新")}<br />{t("收起或切换到后台时暂停刷新")}</p>
      </>}
    </div>}
  </aside>
}

export function CostDebugWindow(props: Placement) {
  const session = useReader(s => s.session)
  if (session.status === 'user' && session.user.can_view_cost_debug) return <AccountCosts key={session.user.id} userId={session.user.id} {...props} />
  return null
}
