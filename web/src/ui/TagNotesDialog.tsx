import { NoteMarkdown } from './NoteMarkdown'
import { t } from '../i18n'
import { useLayoutEffect, useRef } from 'react'
import { noteTagKey } from '../book/noteTags'
import { useReader } from '../store/useReader'
import { Icon } from './icons'
import './tag-notes.css'

/** A live, book-scoped view of existing annotations; opening it does not call AI or storage. */
export function TagNotesDialog({ tag, bookId, anchor, onClose }: {
  tag: string; bookId: string; anchor: HTMLButtonElement; onClose: () => void
}) {
  const { current, annotations, scene } = useReader()
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const key = noteTagKey(tag)
  const matches = annotations.filter(a => a.bookId === bookId && a.note?.tags?.some(t => noteTagKey(t) === key))
    .sort((a, b) => a.locator.chapter - b.locator.chapter || a.locator.start - b.locator.start || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  useLayoutEffect(() => {
    const el = dialog.current!
    scene?.suspendInteraction(true)
    el.showModal()
    close.current?.focus({ preventScroll: true })
    return () => {
      el.close()
      scene?.suspendInteraction(false)
      if (anchor.isConnected && !anchor.disabled) anchor.focus({ preventScroll: true })
    }
  }, [scene, anchor])
  return <dialog ref={dialog} className="tag-notes-dialog" data-ui aria-labelledby="tag-notes-title"
    onCancel={event => { event.preventDefault(); onClose() }} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <header>
      <div><span className="tag-notes-eyebrow">{current?.meta.title} {t("· 标签笔记")}</span>
        <h2 id="tag-notes-title">#{tag}</h2><p>{matches.length} {t("条笔记 · 仅当前书籍 · 按原文顺序")}</p></div>
      <button ref={close} type="button" className="ib" aria-label={t("关闭标签笔记")} title={t("关闭标签笔记")} onClick={onClose}><Icon.close /></button>
    </header>
    <div className="tag-notes-content" tabIndex={0} aria-label={t("本书中 #{0} 的原文和笔记", tag)}>
      {matches.length ? <div className="tag-notes-list">{matches.map(a => <article className="tag-notes-card" key={a.id} data-annotation-id={a.id}>
        <div className="tag-notes-source"><span>{current?.parsed.chapters[a.locator.chapter]?.title || t("第 {0} 节", a.locator.chapter + 1)}</span>
          <button type="button" className="btn" onClick={() => {
            onClose()
            scene?.revealLocator(a.locator)
          }}>{t("回到原文")} <Icon.right size={14} /></button></div>
        <span className="tag-notes-label">{t("原文")}</span><blockquote>{a.quote || t("此标注未保存原文摘录。")}</blockquote>
        {a.note!.text.trim() && <><span className="tag-notes-label">{t("笔记")}</span><div className="tag-notes-text"><NoteMarkdown text={a.note!.text} /></div></>}
        <div className="tag-notes-tags">{a.note!.tags?.map(t => <span className={noteTagKey(t) === key ? 'is-active' : ''} key={t}>#{t}</span>)}</div>
      </article>)}</div> : <p className="tag-notes-empty">{t("本书暂无带此标签的笔记。")}</p>}
    </div>
  </dialog>
}
