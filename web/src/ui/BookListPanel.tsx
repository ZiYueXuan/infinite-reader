import { useReader } from '../store/useReader'
import { useEffect, useRef, useState } from 'react'
import type { BookListState } from '../../../shared/booklist'
import { api, jsonBody } from '../api/http'
import { t } from '../i18n'
import { Icon } from './icons'
import './booklist.css'

function failureText(code?: string) {
  if (code === 'booklist_truncated') return t('Book list output was incomplete.')
  if (code === 'booklist_evidence_empty') return t('None of the candidate books could be verified against the source.')
  if (code === 'booklist_invalid') return t('The model response could not be verified against the book.')
  if (code === 'booklist_too_large') return t('This book exceeds the extraction size limit.')
  if (code === 'booklist_empty_source' || code === 'booklist_source_missing') return t('Readable source text is unavailable for this book.')
  if (code === 'booklist_timeout') return t('The extraction request timed out.')
  return t('Book list extraction did not finish.')
}

/** Mount keyed by book/account; reading status and reopening never trigger inference. */
export function BookListPanel({ bookId, available }: { bookId: string; available: boolean }) {
  const canSeeCosts = useReader(s => s.session.status === 'user' && s.session.user.can_view_cost_debug)
  const [state, setState] = useState<BookListState | null>(available ? null : { status: 'missing' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const alive = useRef(false), submitting = useRef(false)
  const path = `/books/${encodeURIComponent(bookId)}/booklist`
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!available || busy) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let reading = false
    const check = async () => {
      if (controller.signal.aborted || reading || document.hidden) return
      reading = true
      clearTimeout(timer)
      try {
        const value = await api<BookListState>(path, { signal: controller.signal })
        if (controller.signal.aborted) return
        setState(value); setError('')
        if (value.status !== 'missing') setRequestError('')
        if (value.status === 'running') timer = setTimeout(() => void check(), 5000)
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('Network error'))
      } finally { reading = false }
    }
    void check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [available, path, refresh, busy])
  const extract = async (retry: boolean) => {
    if (submitting.current || !available) return
    submitting.current = true
    setBusy(true); setError(''); setRequestError('')
    try {
      const value = await api<BookListState>(path, { method: 'POST', body: jsonBody({ retry }) })
      if (alive.current) setState(value)
    } catch (e) {
      if (alive.current) setRequestError(e instanceof Error ? e.message : t('Network error'))
    } finally {
      submitting.current = false
      if (alive.current) { setBusy(false); setRefresh(n => n + 1) }
    }
  }
  const failed = state?.status === 'failed' || state?.status === 'interrupted'
  return <section className="booklist-panel" aria-label={t('Book list')}>
    {(error || requestError) && <div className="booklist-error" role="alert"><p>{error || requestError}</p><button className="btn" onClick={() => setRefresh(n => n + 1)}>{t('Check saved status')}</button></div>}
    {!state && !error && <p className="hint" role="status">{t('Loading…')}</p>}
    {state?.status === 'missing' && <div className="booklist-empty">
      <Icon.library size={30} />
      <p>{t('Collect the books mentioned in this book, with excerpts for reference.')}</p>
      <button className="btn primary booklist-extract" disabled={!available || busy} onClick={() => void extract(false)}>
        <Icon.sparkle size={17} /><span>{busy ? t('Starting extraction…') : t('Extract book list')}<small>{t('Summarize the book titles mentioned in this book')}</small></span>
      </button>
      <p className="hint">{available ? canSeeCosts ? t('Extracts with AI and saves the result. Tokens and cost appear in Cost Debug.') : t('Extracts with AI and saves the result for later.') : t('Sign in and open an uploaded book to extract its book list.')}</p>
    </div>}
    {state?.status === 'running' && <div className="booklist-progress" role="status">
      <Icon.sparkle size={24} />
      <p>{state.total ? t('Extracting book list · {0} of {1} parts', state.completed ?? 0, state.total) : t('Preparing the full book…')}</p>
      {!!state.total && <progress value={state.completed ?? 0} max={state.total} aria-label={t('Extraction progress')} />}
      <p className="hint">{t('You can close this panel. Extraction continues in the background and is saved automatically.')}</p>
    </div>}
    {failed && <div className="booklist-error">
      <p>{state.status === 'interrupted' ? t('Extraction was interrupted. Check saved status before retrying.') : failureText(state.errorCode)}</p>
      <p className="hint">{t('Completed parts are kept. Available usage is recorded; retrying unfinished parts may incur additional costs.')}</p>
      <button className="btn" disabled={busy} onClick={() => setRefresh(n => n + 1)}>{t('Check saved status')}</button>
      {!['booklist_too_large', 'booklist_empty_source'].includes(state.errorCode ?? '') && <button className="btn" disabled={busy} onClick={() => void extract(true)}>{busy ? t('Starting extraction…') : t('Continue extraction (may incur costs)')}</button>}
    </div>}
    {state?.status === 'ready' && state.result && <>
      <div className="booklist-summary"><b>{t('{0} books mentioned', state.result.books.length)}</b><span>{t('Saved · no new AI call when reopening')}</span></div>
      {!!state.result.excludedCandidates && <p className="hint" role="status">{t('{0} unverified candidates were excluded. The list below contains only source-verified entries and may be incomplete.', state.result.excludedCandidates)}</p>}
      {!state.result.books.length && <p className="hint">{t('No mentioned books were identified.')}</p>}
      <ol className="booklist-items">{state.result.books.map((book, index) => <li key={index}>
        <h3>{book.title}</h3>{book.author && <p className="booklist-author">{book.author}</p>}
        <details><summary>{t('Mention in the original text')}</summary><blockquote>{book.quote}</blockquote></details>
      </li>)}</ol>
      <p className="hint">{t('AI may miss or misidentify titles. Check the quoted text when needed.')}</p>
    </>}
  </section>
}
