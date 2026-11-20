import { chapterIndices } from '../../../shared/chapters'
import { SlidesDialog } from './SlidesDialog'
import { api } from '../api/http'
import { noteMarkdownSummary } from '../book/noteMarkdown'
import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { MARK_COLORS } from '../book/annotations'
import { inferFlatTocLevels } from '../book/tocHierarchy'
import type { TocItem } from '../book/types'
import { canImportBook, useReader } from '../store/useReader'
import { Icon } from './icons'
import { MindmapDialog } from './MindmapDialog'
import { useReadyMindmaps } from '../api/mindmaps'

function Drawer({ title, tabs, onClose, children, side = 'left' }: { title?: React.ReactNode; tabs?: React.ReactNode; onClose: () => void; children: React.ReactNode; side?: 'left' | 'right' }) {
  return (
    <aside className={'drawer ' + side + (tabs ? ' drawer-tabbed' : '')} data-ui onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <header>
        {tabs ?? <h2>{title}</h2>}
        <button className="ib sm" onClick={onClose} title={t("Close")}>
          <Icon.close size={16} />
        </button>
      </header>
      <div className="body">{children}</div>
    </aside>
  )
}

export function LibraryDrawer() {
  const { library, current, openFromLibrary, removeBook, openBlob, openSample, setPanel, session, setShowLogin } = useReader()
  const input = useRef<HTMLInputElement>(null)
  const canAdd = session.status === 'user' && canImportBook()
  return (
    <Drawer title={t("Library")} onClose={() => setPanel('none')}>
      <div className="lib-actions">
        <button
          className="btn primary"
          onClick={() => {
            if (!canImportBook()) {
              void setShowLogin(true)
              return
            }
            input.current?.click()
          }}
        >
          <Icon.upload size={16} /> {t("Add EPUB")}</button>
        <button className="btn" onClick={() => void openSample()}>
          {t("Sample: Alice")}</button>
        <input
          ref={input}
          type="file"
          accept=".epub,application/epub+zip"
          hidden
          disabled={!canAdd}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void openBlob(f, f.name)
          }}
        />
      </div>
      <p className="hint">{canAdd ? t("Drop an .epub file anywhere on the desk to add it.") : t("Sign in to add a book.")}</p>
      <ul className="books">
        {library.map((b) => (
          <li key={b.id} className={current?.meta.id === b.id ? 'cur' : ''}>
            <button className="bk" onClick={() => void openFromLibrary(b.id)}>
              <span className="cv" style={b.coverDataUrl ? { backgroundImage: `url(${b.coverDataUrl})` } : undefined}>
                {!b.coverDataUrl && <em>{b.title.slice(0, 1)}</em>}
              </span>
              <span className="meta">
                <b>{b.title}</b>
                <i>{b.author}</i>
                {b.status && b.status !== 'ready' && <em className={'st ' + b.status}>{b.status === 'failed' ? t("Indexing failed") : t("Indexing for AI{0}", b.indexPercent ? ' ' + b.indexPercent + '%' : '…')}</em>}
              </span>
            </button>
            <button className="ib sm del" title={t("Remove from library")} onClick={() => { if (window.confirm(t("Delete “{0}” and its EPUB, highlights, notes, AI conversations and search data permanently?", b.title))) void removeBook(b.id).catch(() => useReader.getState().say(t("Could not delete this book. Please try again."))) }}>
              <Icon.trash size={15} />
            </button>
          </li>
        ))}
        {!library.length && <li className="empty">{t("Nothing here yet.")}</li>}
      </ul>
    </Drawer>
  )
}

interface TocNode {
  item: TocItem
  index: number
  children: TocNode[]
}

/** Build semantic nested lists without changing the original order or navigation targets. */
function tocTree(items: TocItem[]): TocNode[] {
  const root: TocNode[] = []
  const stack: TocNode[] = []
  items.forEach((item, index) => {
    while (stack.length && stack[stack.length - 1].item.level >= item.level) stack.pop()
    const node: TocNode = { item, index, children: [] }
    if (stack.length) stack[stack.length - 1].children.push(node)
    else root.push(node)
    stack.push(node)
  })
  return root
}

function TocList({ nodes, goToToc, onMindmap, readyTargets, onSlides, slideChapters, readySlides, nested = false }: {
  onSlides: (item: TocItem) => void; slideChapters: Set<number>; readySlides: Set<string>; nodes: TocNode[]; goToToc: (chapter: number, block?: number) => void; onMindmap: (item: TocItem) => void; readyTargets?: Set<string>; nested?: boolean
}) {
  return (
    <ul className={nested ? 'toc-children' : 'toc'} aria-label={nested ? undefined : t("Contents")}>
      {nodes.map(({ item, index, children }) => {
        const ready = !!item.href && !!readyTargets?.has(item.href)
        const label = `${ready ? t("查看已生成的思维导图") : readyTargets ? t("生成思维导图") : t("生成／查看思维导图")}：${item.title}`
        return (
        <li key={index}>
          <div className="toc-row"><button type="button" className={children.length ? 'toc-parent' : undefined}
            onClick={() => goToToc(item.chapter, item.block)}>{item.title}</button>
          <button type="button" className={'toc-mindmap' + (ready ? ' is-ready' : '')} title={label} aria-label={label} onClick={() => onMindmap(item)}>
            <span className="toc-mindmap-visual" aria-hidden="true">
              <Icon.mindmap size={18} />
              {ready && <span className="toc-mindmap-check"><svg viewBox="0 0 12 12"><path d="m2.5 6 2.2 2.2 4.8-4.8" /></svg></span>}
            </span>
          </button>
          {slideChapters.has(index) && <button type="button" className={'toc-mindmap toc-slides' + (item.href && readySlides.has(item.href) ? ' is-ready' : '')}
            title={t('生成／查看章节幻灯片') + '：' + item.title} aria-label={t('生成／查看章节幻灯片') + '：' + item.title} onClick={() => onSlides(item)}>
            <span className="toc-mindmap-visual"><Icon.slides size={18} /></span>
          </button>}</div>
          {children.length > 0 && <TocList nodes={children} goToToc={goToToc} onMindmap={onMindmap} readyTargets={readyTargets} onSlides={onSlides} slideChapters={slideChapters} readySlides={readySlides} nested />}
        </li>
      )})}
    </ul>
  )
}

export function TocDrawer() {
  const { current, annotations, goToToc, scene, setPanel, session } = useReader()
  const [tab, setTab] = useState<'toc' | 'marks'>('toc')
  const [map, setMap] = useState<{ bookId: string; target: string; title: string } | null>(null)
  const readyTargets = useReadyMindmaps(current?.meta.status ? current.meta.id : undefined, session.status === 'user' ? session.user.id : undefined)
  const [deck, setDeck] = useState<{ bookId: string; target: string; title: string } | null>(null)
  const [slideIndex, setSlideIndex] = useState<{ key: string; targets: Set<string> } | null>(null)
  const indexKey = `${session.status === 'user' ? session.user.id : ''}:${current?.meta.id ?? ''}`
  useEffect(() => {
    if (session.status !== 'user' || !current?.meta.status) return
    let cancelled = false
    void api<{ readyTargets: string[] }>(`/books/${encodeURIComponent(current.meta.id)}/slides-index`).then(index => {
      if (!cancelled) setSlideIndex({ key: indexKey, targets: new Set(index.readyTargets) })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [indexKey, current?.meta.status, current?.meta.id, session.status])
  if (!current) return null
  const slideChapters = new Set(chapterIndices(current.parsed.toc))
  const readySlides = slideIndex?.key === indexKey ? slideIndex.targets : new Set<string>()
    // Clause marks are a reading aid along the text, not a saved highlight; a dense passage must not bury notes.
    const marks = annotations.filter((a) => a.kind !== 'judou').sort((a, b) => a.locator.chapter - b.locator.chapter || a.locator.start - b.locator.start)
  return (
    <Drawer onClose={() => setPanel('none')} tabs={
      <div className="tabs">
        <button className={tab === 'toc' ? 'on' : ''} onClick={() => setTab('toc')}>
          {t("Contents")}</button>
        <button className={tab === 'marks' ? 'on' : ''} onClick={() => setTab('marks')}>
          {t("Marks & notes")} <span className="n">{marks.length}</span>
        </button>
      </div>
    }>
      {tab === 'toc' ? (
        <TocList nodes={tocTree(inferFlatTocLevels(current.parsed.toc))} goToToc={goToToc} readyTargets={readyTargets} slideChapters={slideChapters} readySlides={readySlides} onSlides={item => {
          if (session.status !== 'user' || !current.meta.status) { useReader.getState().say(t('请登录并从书架打开已上传的书籍，再生成幻灯片。')); return }
          if (!item.href) { useReader.getState().say(t('请重新打开书籍以加载完整目录。')); return }
          setDeck({ bookId: current.meta.id, target: item.href, title: item.title })
        }} onMindmap={item => {
          if (useReader.getState().session.status !== 'user' || !current.meta.status) { useReader.getState().say(t("请登录并从书架打开已上传的书籍，再生成思维导图。")); return }
          const target = item.href
          if (!target) { useReader.getState().say(t("请重新打开书籍以加载完整目录。")); return }
          setMap({ bookId: current.meta.id, target, title: item.title })
        }} />
      ) : (
        <ul className="marks">
          {marks.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => {
                  setPanel('none')
                  scene?.revealLocator(a.locator)
                }}
              >
                <span className="dot" style={{ background: MARK_COLORS[a.color].fill }} />
                <span className="q">“{a.quote.length > 140 ? a.quote.slice(0, 137) + '…' : a.quote}”</span>
                {a.note?.text && <span className="nt">{noteMarkdownSummary(a.note.text)}</span>}
              </button>
            </li>
          ))}
          {!marks.length && <li className="empty">{t("Select text to highlight, underline or attach an inline note.")}</li>}
        </ul>
      )}
      {deck && deck.bookId === current.meta.id && <SlidesDialog key={indexKey + deck.target} {...deck} scene={scene} onClose={() => setDeck(null)} onReady={() => setSlideIndex(previous => ({ key: indexKey, targets: new Set([...(previous?.key === indexKey ? previous.targets : []), deck.target]) }))} />}
      {map && map.bookId === current.meta.id && <MindmapDialog key={map.bookId + map.target} {...map} scene={scene} onClose={() => setMap(null)} />}
    </Drawer>
  )
}
