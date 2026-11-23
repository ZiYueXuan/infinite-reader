import { t, useT } from '../i18n'
import { visibleAnswer } from '../../../shared/agentText'
import { lazy, memo, Suspense, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import type { Element } from 'hast'
import type { Citation, BookCitation } from '../api/ask'
import { webSourceUrl } from '../../../shared/citations'
import type { Locator } from '../book/annotations'
import type { CurrentBook } from '../store/useReader'
import { pathForPassage } from '../route/passage'
import { citationLocator } from './citationTarget'
import { answerSchema, markdownNodeText, rehypeReaderMarkdown } from './answerMarkdown'
import 'katex/dist/katex.min.css'
import './answer-markdown.css'

const MermaidBlock = lazy(() => import('./MermaidBlock'))
const NO_CITATIONS: Citation[] = []

function CodeBlock({ node, children, streaming }: { node?: Element; children?: ReactNode; streaming: boolean }) {
  const code = node?.children.find(n => n.type === 'element' && n.tagName === 'code') as Element | undefined
  const language = String(code?.properties.className ?? '').match(/language-([\w+-]+)/)?.[1] ?? ''
  const source = code ? markdownNodeText(code) : ''
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async () => {
    try { await navigator.clipboard.writeText(source); setCopied(source) } catch { setCopied(null) }
  }
  return <div className="answer-code">
    <div className="answer-code-toolbar"><span>{language || t('text')}</span><button type="button" onClick={() => void copy()} aria-label={t("Copy code")}>{copied === source ? t("Copied") : t("Copy")}</button></div>
    {language === 'mermaid' && !streaming ? <Suspense fallback={<pre>{children}</pre>}><MermaidBlock source={source} /></Suspense> : <pre>{children}</pre>}
  </div>
}

export const AnswerText = memo(function AnswerText({ text, citations = NO_CITATIONS, book, onNavigate, streaming = false, interrupted = false }: {
  text: string
  citations?: Citation[]
  book: CurrentBook
  onNavigate: (loc: Locator) => void
  streaming?: boolean
  interrupted?: boolean
}) {
  const t = useT()
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const container = useRef<HTMLDivElement>(null)
  const targets = useMemo(() => {
    const result = new Map<number, { citation: BookCitation; locator: Locator }>()
    for (const citation of citations) {
      if (citation.kind === 'web') continue
      const locator = citationLocator(citation, book.parsed.chapters)
      if (locator && Number.isSafeInteger(citation.n) && citation.n > 0) result.set(citation.n, { citation, locator })
    }
    return result
  }, [citations, book.parsed])
  const external = useMemo(() => new Map(citations.flatMap(c => c.kind === 'web' && Number.isSafeInteger(c.n) && c.n > 0 && webSourceUrl(c.url) ? [[c.n, c] as const] : [])), [citations])
  const readerOptions = useMemo(() => ({ prefix: `answer-${instance}-`, citations: new Map([
    ...[...targets].map(([n, t]) => [n, pathForPassage(book.meta.id, t.locator)] as const),
    ...[...external].map(([n, c]) => [n, c.url] as const),
  ]) }), [instance, targets, external, book.meta.id])
  const components = useMemo<Components>(() => ({
    a({ node, href, children, ...props }) {
      const source = external.get(Number(node?.properties.dataBookCitation))
      if (source) return <sup className="answer-citation"><a href={source.url} target="_blank" rel="noopener noreferrer" title={source.title + '\n' + source.snippet} aria-label={t('External source {0}: {1}', source.n, source.title)}>{source.n}</a></sup>
      const target = targets.get(Number(node?.properties.dataBookCitation))
      if (target) {
        const { citation, locator } = target
        const chapter = citation.chapterTitle || book.parsed.chapters[locator.chapter].title || t("Section {0}", locator.chapter + 1)
        return <sup className="answer-citation"><a href={pathForPassage(book.meta.id, locator)} aria-label={t("Reference {0}: {1}. Go to passage", citation.n, chapter)} title={`${chapter}\n${citation.snippet}`} onClick={e => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault(); onNavigate(locator)
        }}>{citation.n}</a></sup>
      }
      return <a {...props} href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer" onClick={e => {
        if (!href?.startsWith('#') || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        const target = document.getElementById(href.slice(1))
        if (target && container.current?.contains(target)) { e.preventDefault(); target.scrollIntoView({ block: 'nearest' }); target.focus({ preventScroll: true }) }
      }}>{children}</a>
    },
    pre: ({ node, children }) => <CodeBlock node={node} streaming={streaming}>{children}</CodeBlock>,
    table: ({ node: _node, ...props }) => <div className="answer-table" tabIndex={0} role="region" aria-label={t("Table (scroll horizontally)")}><table {...props} /></div>,
    img: ({ node: _node, ...props }) => <img {...props} loading="lazy" referrerPolicy="no-referrer" />,
  }), [targets, external, book, onNavigate, streaming, t])
  const answer = visibleAnswer(text, !streaming)
  return <div className="answer-markdown" ref={container}><Markdown
    remarkPlugins={[remarkGfm, remarkMath, remarkCjkFriendly]}
    remarkRehypeOptions={{ footnoteLabel: t("Notes"), footnoteBackLabel: (referenceIndex: number) => t('Back to reference {0}', referenceIndex + 1), clobberPrefix: '' }}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, answerSchema], [rehypeReaderMarkdown, readerOptions], [rehypeKatex, { strict: false, trust: false, maxExpand: 1000, maxSize: 20 }], [rehypeHighlight, { detect: false }]]}
    components={components}
  >{answer}</Markdown>{!streaming && (interrupted || answer !== text) && <p role="status">{t("The AI response was interrupted. Please try again.")}</p>}</div>
})
