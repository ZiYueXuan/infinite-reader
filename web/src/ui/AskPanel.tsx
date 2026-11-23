import { t } from '../i18n'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { askClient, getAskHistory, type AskRequest, type AskOperation, type AskEvent, type Citation, type BookCitation } from '../api/ask'
import { webSourceUrl } from '../../../shared/citations'
import type { Locator } from '../book/annotations'
import { validatePassage } from '../route/passage'
import { getStorageMode } from '../storage/mode'
import { useReader, type CurrentBook } from '../store/useReader'
import { citationLocator } from './citationTarget'
import { askReadingPosition } from './askReadingPosition'
import { Icon } from './icons'
import './ask.css'

const AnswerText = lazy(() => import('./AnswerText').then(module => ({ default: module.AnswerText })))

interface Msg {
  id: string
  role: 'user' | 'ai'
  text: string
  selection?: string
  streaming?: boolean
  error?: boolean
  interrupted?: boolean
  citations?: Citation[]
  status?: string
}

const PASSAGE_QUESTIONS = ['Explain this passage', 'What does it mean here?', 'Summarize in one line']
const BOOK_QUESTIONS = ['What is this book about?', 'What are the key ideas?', 'Introduce the main people and places']

/** One chip per chapter: the retrieved passages are numbered in the answer, so keep every [n] but show the chapter once. */
function groupCitations(list: Citation[]) {
  const by = new Map<number, { chapterIndex: number; ns: number[]; first: BookCitation }>()
  for (const c of [...list].sort((a, b) => a.n - b.n)) {
    if (c.kind === 'web') continue
    const g = by.get(c.chapterIndex)
    if (g) g.ns.push(c.n)
    else by.set(c.chapterIndex, { chapterIndex: c.chapterIndex, ns: [c.n], first: c })
  }
  return [...by.values()]
}

export function AskPanel() {
  const current = useReader((s) => s.current)
  // Keep one conversation mounted while collapsed, and isolate it when switching books.
  return current ? <BookChat key={current.meta.id} current={current} /> : null
}

function BookChat({ current }: { current: CurrentBook }) {
  const { ask, openAsk, closeAsk, scene, session, showLogin, loading, setShowLogin } = useReader()
  const canAsk = session.status === 'user' && getStorageMode() === 'api'
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const operation = useRef<AskOperation | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const threadContent = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const scrollLayout = useRef({ height: 0, viewport: 0 })
  const chatVisible = !!ask && !showLogin && !loading
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const passage = ask?.kind === 'passage' ? ask : null

  async function follow(replyId: string, op: AskOperation, stream: (signal: AbortSignal) => AsyncGenerator<AskEvent>) {
    const ctl = new AbortController()
    abort.current = ctl
    operation.current = op
    const updateReply = (update: (message: Msg) => Msg) => setMsgs((messages) => messages.map((m) => m.id === replyId ? update(m) : m))
    try {
      for await (const ev of stream(ctl.signal)) {
        if (ctl.signal.aborted) break
        if (ev.type === 'meta') {
          updateReply((m) => ({ ...m, citations: ev.citations }))
        } else if (ev.type === 'answer') {
          updateReply((m) => ({ ...m, text: ev.text, status: ev.text ? undefined : m.status }))
        } else if (ev.type === 'delta') {
          updateReply((m) => ({ ...m, text: m.text + ev.text }))
        } else if (ev.type === 'tool') {
          const status = ev.name === 'search_web' ? t('Searching external sources…') : ev.name === 'search_book' ? t("Searching this book…") : ev.name === 'get_book_outline' ? t("Checking the contents…") : t("Reading the passage…")
          updateReply((m) => ({ ...m, status }))
        } else if (ev.type === 'error') {
          throw new Error(ev.message)
        }
      }
    } catch (err) {
      if (!ctl.signal.aborted) {
        const error = err instanceof Error ? err.message : t("Something went wrong.")
        updateReply((m) => ({ ...m, text: m.text ? `${m.text}\n\n${error}` : error, error: true }))
      }
    } finally {
      if (abort.current === ctl) { abort.current = null; operation.current = null }
      updateReply((m) => ({ ...m, streaming: false, text: m.text || (ctl.signal.aborted ? t("Response stopped.") : t("No response received. Please try again.")) }))
    }
  }

  useEffect(() => {
    if (!canAsk) return
    const ctl = new AbortController()
    void getAskHistory(current.meta.id, ctl.signal).then((history) => {
      if (ctl.signal.aborted) return
      const restored: Msg[] = history.messages.map((m) => ({ id: m.id, role: m.role === 'assistant' ? 'ai' : 'user', text: m.content, interrupted: m.interrupted, selection: m.selection?.text, citations: m.citations }))
      if (history.pending && !restored.some(m => m.id === history.pending!.messageId)) restored.push({ id: history.pending.messageId, role: 'ai', text: '', streaming: true, status: t("Reconnecting…") })
      setMsgs(restored)
      setHistoryStatus('ready')
      if (history.pending) {
        const op = { bookId: current.meta.id, operationId: history.pending.operationId, threadId: 'default' }
        void follow(history.pending.messageId, op, signal => askClient.resume(op, signal))
      }
    }).catch(() => {
      if (!ctl.signal.aborted) setHistoryStatus('error')
    })
    return () => ctl.abort()
  }, [canAsk, current.meta.id, historyAttempt])

  // Disconnecting the view keeps the durable operation alive; only Stop cancels it.
  useEffect(() => () => abort.current?.abort(), [canAsk])

  useEffect(() => {
    if (!ask || showLogin || !canAsk || historyStatus !== 'ready') return
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [ask, showLogin, canAsk, historyStatus])

  useLayoutEffect(() => {
    const thread = scroller.current, content = threadContent.current
    if (!chatVisible || !thread || !content) return
    // Every opening starts at the latest message, including cached conversations.
    followBottom.current = true
    const scrollToLatest = () => {
      if (followBottom.current) thread.scrollTop = thread.scrollHeight
      scrollLayout.current = { height: thread.scrollHeight, viewport: thread.clientHeight }
    }
    scrollToLatest()
    // Suspense, Markdown, images and streamed replies can change height after commit.
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(content)
    observer.observe(thread)
    return () => observer.disconnect()
  }, [chatVisible])

  const buildRequest = (question: string): AskRequest => {
    const request: AskRequest = { bookId: current.meta.id, question, threadId: 'default', operationId: crypto.randomUUID() }
    const pages = scene?.pagination?.pages
    const visible = scene?.visiblePages
    const page = pages && visible ? pages[visible.left] ?? pages[visible.right] : undefined
    request.readingPosition = askReadingPosition(current.parsed.chapters, page, passage?.locator)
    if (!passage) return request
    const chapter = current.parsed.chapters[passage.locator.chapter]
    const text = chapter ? chapter.blocks.map((b) => b.text).join('\n') : ''
    return {
      ...request,
      selection: { text: passage.text, chapterTitle: chapter?.title, anchor: { chapter: passage.locator.chapter, start: passage.locator.start, end: passage.locator.end } },
      context: {
        before: text.slice(Math.max(0, passage.locator.start - 700), passage.locator.start),
        after: text.slice(passage.locator.end, passage.locator.end + 700),
        chapterTitle: chapter?.title,
      },
    }
  }

  const send = async (question: string) => {
    question = question.trim()
    if (!question || !canAsk || historyStatus !== 'ready' || abort.current) return
    followBottom.current = true
    const replyId = crypto.randomUUID()
    const request = buildRequest(question)
    setQ('')
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: 'user', text: question, selection: passage?.text }, { id: replyId, role: 'ai', text: '', streaming: true, status: t("Thinking…") }])
    await follow(replyId, { bookId: request.bookId, threadId: request.threadId, operationId: request.operationId! }, signal => askClient.ask(request, signal))
  }

  const stop = async () => {
    const ctl = abort.current, op = operation.current
    if (!ctl || !op) return
    try { await askClient.cancel(op); ctl.abort() }
    catch { setMsgs(messages => messages.map(m => m.streaming ? { ...m, status: t("Could not stop the response. Please try Stop again.") } : m)) }
  }

  const streaming = msgs.some((m) => m.streaming)
  const collapse = useCallback(() => {
    closeAsk()
    launcher.current?.focus({ preventScroll: true })
  }, [closeAsk])
  const revealPassage = useCallback((loc: Locator) => {
    const target = validatePassage(loc, current.parsed.chapters)
    if (!scene || !target) return
    collapse()
    scene.clearSelection()
    scene.revealLocator(target)
  }, [scene, current.parsed.chapters, collapse])
  const questions = passage ? PASSAGE_QUESTIONS : BOOK_QUESTIONS
  if (showLogin || loading) return null

  return (
    <div className="reading-agent" data-ui onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && !e.nativeEvent.isComposing && ask) { e.preventDefault(); collapse() }
      }}>
    <button ref={launcher} type="button" className={'agent-launcher' + (ask ? ' on' : '')}
      aria-label={ask ? t("Close Infinite") : t("Open Infinite")} aria-expanded={!!ask} aria-controls="reader-agent-chat" aria-haspopup="dialog"
      title={ask ? t("Close Infinite") : t("Ask Infinite about this book")} onClick={() => ask ? collapse() : openAsk()}>
      {ask ? <Icon.minus size={19} /> : <Icon.sparkle size={19} />}<span>Infinite</span>
      {!ask && streaming && <span className="agent-activity" role="status" aria-label={t("Infinite is replying")} />}
    </button>
    {ask && <aside id="reader-agent-chat" className={'ask' + (expanded ? ' is-expanded' : '')} role="dialog" aria-modal="false" aria-labelledby="reader-agent-title">
      <header>
        <span className="spark"><Icon.sparkle size={19} /></span>
        <div className="ask-heading">
          <h2 id="reader-agent-title">Infinite</h2>
          <p title={current.meta.title}>{current.meta.title}</p>
        </div>
        <div className="ask-window-controls">
          <button type="button" className="ib" onClick={() => setExpanded(value => !value)}
            title={expanded ? t("Restore original size") : t("Expand window")} aria-label={expanded ? t("Restore Infinite size") : t("Expand Infinite")} aria-pressed={expanded} aria-controls="reader-agent-chat">
            {expanded ? <Icon.shrink size={18} /> : <Icon.fit size={18} />}
          </button>
          <button type="button" className="ib" onClick={collapse} title={t("Close · Esc")} aria-label={t("Close Infinite window")}>
            <Icon.close size={18} />
          </button>
        </div>
      </header>
      {passage && <div className="ask-context">
        <div><span>{t('SELECTED PASSAGE')}</span><button type="button" className="ib sm" title={t("Ask about the whole book")} aria-label={t("Clear selected passage")} onClick={openAsk}><Icon.close size={13} /></button></div>
        <blockquote>{passage.text.length > 260 ? passage.text.slice(0, 257) + '…' : passage.text}</blockquote>
      </div>}
      <div className="thread" ref={scroller} role="log" aria-label={t("Conversation")} aria-live="polite" aria-busy={streaming}
        onScroll={event => {
          if (event.target !== event.currentTarget) return
          const thread = event.currentTarget
          // Browser scroll anchoring during reflow is not a request to read older messages.
          if (thread.scrollHeight !== scrollLayout.current.height || thread.clientHeight !== scrollLayout.current.viewport) return
          followBottom.current = thread.scrollHeight - thread.clientHeight - thread.scrollTop <= 24
        }}>
        <div className="thread-content" ref={threadContent}>
        {canAsk && historyStatus === 'loading' && <p className="ask-status" role="status">{t("Loading your conversation…")}</p>}
        {canAsk && historyStatus === 'error' && <div className="ask-status" role="alert">{t("Could not load your conversation.")}<button type="button" className="btn small" onClick={() => { setHistoryStatus('loading'); setHistoryAttempt((v) => v + 1) }}>{t("Try again")}</button></div>}
        {(!canAsk || (historyStatus === 'ready' && !msgs.length)) && (
          <div className="ask-welcome">
            <span className="ask-book-icon"><Icon.book size={28} /></span>
            <span className="ask-eyebrow">{t('YOUR READING COMPANION')}</span>
            <h3>{passage ? t("A closer look at the words.") : t("There’s more between the lines.")}</h3>
            <p>{canAsk ? t("Ask a question, connect ideas, or explore a little further.") : t("Sign in to explore this book with AI and keep your conversations.")}</p>
            {canAsk ? <div className="quick">{questions.map((s) => <button type="button" key={s} onClick={() => void send(t(s))}><span>{t(s)}</span><Icon.right size={14} /></button>)}</div>
              : <button type="button" className="btn" onClick={() => void setShowLogin(true)}>{t("Sign in to chat")}</button>}
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={'msg ' + m.role + (m.error ? ' err' : '')}>
            {m.role === 'ai' ? (
              <>
                {m.streaming && m.status && <span className="ask-thinking" role="status">{t(m.status)}</span>}
                <Suspense fallback={<p className="ask-thinking">{t("Formatting response…")}</p>}>
                  <AnswerText streaming={m.streaming} interrupted={m.interrupted} text={m.text} citations={m.citations} book={current} onNavigate={revealPassage} />
                </Suspense>
                {m.streaming && <span className="caret" />}
                {!!m.citations?.length && (
                  <div className="cites">
                    {m.citations.filter(c => c.kind === 'web').map(c => webSourceUrl(c.url) && <a key={'web-' + c.n} href={c.url} target="_blank" rel="noopener noreferrer" title={c.snippet}>
                      <b>{c.n}</b><span>{t('Web')}: {c.title}</span>
                    </a>)}
                    {groupCitations(m.citations).map((g) => (
                      <button
                        key={g.chapterIndex}
                        title={g.first.snippet}
                        onClick={() => {
                          const loc = citationLocator(g.first, current.parsed.chapters)
                          if (loc) revealPassage(loc)
                        }}
                      >
                        <b>{g.ns.join('·')}</b>
                        <span>{g.first.chapterTitle ?? t("Section {0}", g.chapterIndex + 1)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : <>{m.selection && <blockquote>{m.selection.length > 160 ? m.selection.slice(0, 157) + '…' : m.selection}</blockquote>}{m.text}</>}
          </div>
        ))}
        </div>
      </div>
      <form className="ask-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send(q)
        }}
      >
        <label className="sr-only" htmlFor="agent-question">{t("Your question")}</label>
        <textarea id="agent-question" ref={inputRef} rows={2} maxLength={4000} value={q} disabled={!canAsk || historyStatus !== 'ready'} onChange={(e) => setQ(e.target.value)}
          title={t('Web search is off by default. Explicitly ask “search the web” when needed.')}
          placeholder={passage ? t("Ask about this passage…") : t("Ask about this book…")}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(q) }
          }} />
        {streaming ? (
          <button type="button" className="ib go" title={t("Stop response")} aria-label={t("Stop response")} onClick={() => void stop()}>
            <Icon.stop />
          </button>
        ) : (
          <button type="submit" className="ib go" disabled={!q.trim() || !canAsk || historyStatus !== 'ready'} title={t("Send")} aria-label={t("Send question")}>
            <Icon.send />
          </button>
        )}
      </form>
    </aside>}
    </div>
  )
}
