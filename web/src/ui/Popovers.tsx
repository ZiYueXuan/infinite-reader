import { NoteSaveStatus } from './NoteSaveStatus'
import { NoteResizeHandle } from './NoteResizeHandle'
import { LiveNoteEditor, type LiveNoteEditorHandle } from './LiveNoteEditor'
import { annotationMindmapTarget } from '../../../shared/mindmap'
import { useReadyMindmaps } from '../api/mindmaps'
import { flushStorage, storage } from '../storage'
import { MindmapDialog } from './MindmapDialog'
import { t, localeUrl } from '../i18n'
import { NOTE_FONTS, noteFontIdOf, noteFontFamily } from '../book/noteFontCatalog'
import { ensureInlineNoteFont } from '../book/fonts'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
    MARK_COLORS,
    NOTE_TEXT_COLORS,
    resolveJudou,
    judouSymbolOf,
    noteTextColorOf,
    type MarkColor,
    type MarkKind,
    type NoteTextColor
} from '../book/annotations'
import { NOTE_TAG_LIMIT, NOTE_TAG_MAX_GRAPHEMES, addNoteTags, clipGraphemes, removeNoteTag, replaceNoteTag, splitTagDraft } from '../book/noteTags'
import { useReader } from '../store/useReader'
import { Icon } from './icons'
import { noteEditorLayout, initialNoteEditorGeometry } from './noteEditorLayout'

function tidyTagInput(value: string) {
  return clipGraphemes(value.replace(/^(?:[#＃]+\s*)+/u, ''), NOTE_TAG_MAX_GRAPHEMES)
}

function isComposing(e: ReactKeyboardEvent) {
  return e.nativeEvent.isComposing || e.key === 'Process'
}

/** Pointer and mouse both arrive for one press. Act on pointerdown, and on mouse only when pointerdown did not. */
function beginPress(e: { type: string; preventDefault: () => void; stopPropagation: () => void }, seen: { current: number }) {
  e.preventDefault()
  e.stopPropagation()
  if (e.type === 'pointerdown') {
    seen.current = performance.now()
    return true
  }
  return performance.now() - seen.current > 500
}

type Rect = { left: number; top: number; width: number; height: number }

export function Floating({ rect, children, className = '', gap = 10, onDismiss }: { rect: Rect; children: React.ReactNode; className?: string; gap?: number; onDismiss?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    if (!onDismiss) return
    const onPress = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target instanceof Node && ref.current?.contains(event.target))) return
      onDismiss()
    }
    window.addEventListener('pointerdown', onPress, true)
    return () => window.removeEventListener('pointerdown', onPress, true)
  }, [onDismiss])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = rect.left + rect.width / 2 - w / 2
    x = Math.max(10, Math.min(window.innerWidth - w - 10, x))
    let y = rect.top - h - gap
    let below = false
    if (y < 56) {
      y = rect.top + rect.height + gap
      below = true
    }
    y = Math.min(window.innerHeight - h - 80, y)
    setPos({ x, y, below })
  }, [rect.left, rect.top, rect.width, rect.height, gap, children])
  return (
    <div
      ref={ref}
      data-ui
      className={'pop ' + className + (pos?.below ? ' below' : '')}
      style={{ transform: `translate(${pos?.x ?? -999}px, ${pos?.y ?? -999}px)`, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  )
}

function Swatches({ value, onPick }: { value?: MarkColor; onPick: (c: MarkColor) => void }) {
  return (
    <div className="swatches">
      {(Object.keys(MARK_COLORS) as MarkColor[]).map((c) => (
        <button key={c} className={'sw' + (value === c ? ' on' : '')} title={t(MARK_COLORS[c].label)} style={{ ['--c' as string]: MARK_COLORS[c].fill }} onClick={() => onPick(c)} />
      ))}
    </div>
  )
}

function KindToggle({ value, onPick }: { value: MarkKind; onPick: (k: MarkKind) => void }) {
  return (
    <div className="seg">
      <button className={value === 'highlight' ? 'on' : ''} title={t("Highlighter")} onClick={() => onPick('highlight')}>
        <Icon.highlight size={16} />
      </button>
      <button className={value === 'underline' ? 'on' : ''} title={t("Underline")} onClick={() => onPick('underline')}>
        <Icon.underline size={16} />
      </button>
    </div>
  )
}

export function SelectionPopover({ onTextMap }: { onTextMap: (text: string) => void }) {
  const { popover, mark, lastKind, lastColor, annotations, startAsk, say, toggleJudou, current } = useReader()
  if (!popover || popover.kind !== 'selection') return null
  const range = popover.locator
  const target = range && resolveJudou(current?.parsed.chapters[range.chapter], range, annotations)
  return (
    <Floating rect={popover.rect}>
      <KindToggle value={lastKind} onPick={(k) => useReader.setState({ lastKind: k })} />
      <Swatches onPick={(c) => void mark(lastKind, c)} />
      <span className="sep" />
      <button className={'ib' + (target?.existing ? ' on' : '')} title={t("句读")} aria-label={t("句读")}
        aria-pressed={!!target?.existing} disabled={!target} onClick={() => range && void toggleJudou(range)}>
        <Icon.judou />
      </button>
      <button className="ib" title={t("Add inline note")} aria-label={t("Add inline note")} onClick={() => void mark(lastKind, lastColor, true)}>
        <Icon.note />
      </button>
      <button className="askbtn" title={t("Ask AI about this")} onClick={() => startAsk()}>
        <Icon.sparkle size={16} /> {t("Ask AI")}</button>
      <button className="ib" title={t('生成阅读地图')} aria-label={t('生成阅读地图')} onClick={() => onTextMap(popover.text ?? '')}><Icon.globe /></button>
      <button
        className="ib"
        title={t("Copy")}
        onClick={() => {
          void navigator.clipboard?.writeText(popover.text ?? '')
          say(t("Copied"))
        }}
      >
        <Icon.copy />
      </button>
    </Floating>
  )
}

export function MarkPopover({ onTextMap }: { onTextMap: (text: string) => void }) {
  const { popover, annotations, restyle, removeMark, addNoteToMark, setPopover, startAsk, current, session, scene, say } = useReader()
  const [map, setMap] = useState<{ bookId: string; target: string; title: string } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const preparingRef = useRef(false)
  const a = popover?.kind === 'mark' ? annotations.find(x => x.id === popover.id) : undefined
    const readyTargets = useReadyMindmaps(current?.meta.status && (popover?.kind === 'mark' || map) && a?.kind !== 'judou' ? current.meta.id : undefined, session.status === 'user' ? session.user.id : undefined)
  const ready = !!a && readyTargets?.has(annotationMindmapTarget(a.id))
  const mapLabel = ready ? t("查看划线思维导图（已保存）") : t("生成划线思维导图")
  const openMap = async () => {
    if (!a || !current || preparingRef.current) return
    if (session.status !== 'user' || !current.meta.status) { say(t("请登录并从书架打开已上传的书籍，再生成思维导图。")); return }
    preparingRef.current = true
    setPreparing(true)
    try {
      if (!ready) {
        // Flush this annotation even if its debounced creation is still in flight.
        await storage.putAnnotation(a)
        await flushStorage()
      }
      const live = useReader.getState()
      if (live.current !== current || live.session !== session || !live.annotations.some(mark => mark.id === a.id)) return
      setMap({ bookId: current.meta.id, target: annotationMindmapTarget(a.id), title: Array.from(a.quote.replace(/\s+/g, ' ')).slice(0, 60).join('') + (Array.from(a.quote).length > 60 ? '…' : '') })
      setPopover(null)
    } catch { say(t("划线尚未同步，请检查网络后重试。")) }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  return (
    <>
    {map && <MindmapDialog key={map.bookId + map.target} {...map} scene={scene} onClose={() => setMap(null)} />}
        {a && popover && a.kind === 'judou' &&
            <Floating rect={popover.rect} className="mark-popover" onDismiss={() => setPopover(null)}>
                <span className="judou-preview" title={t("句读")} aria-hidden="true">{judouSymbolOf(a.symbol)}</span>
                <button className="ib danger" title={t("Remove mark")} aria-label={t("Remove mark")}
                        onClick={() => void removeMark(a.id)}>
                    <Icon.trash/>
                </button>
            </Floating>}
        {a && popover && a.kind !== 'judou' &&
            <Floating rect={popover.rect} className="mark-popover" onDismiss={() => setPopover(null)}>
      <KindToggle value={a.kind} onPick={(k) => void restyle(a.id, { kind: k })} />
      <Swatches value={a.color} onPick={(c) => {
        void restyle(a.id, { color: c })
        setPopover(null)
      }} />
      <span className="sep" />
      {!a.note ? (
        <button className="ib" title={t("Add inline note")} aria-label={t("Add inline note")} onClick={() => void addNoteToMark(a.id)}>
          <Icon.note />
        </button>
      ) : (
        <button
          className="ib"
          title={t("Edit inline note")} aria-label={t("Edit inline note")}
          onClick={() => {
            void useReader.getState().editNote(a.id)
          }}
        >
          <Icon.note />
        </button>
      )}
      <button className="askbtn" title={t("Ask AI about this")} onClick={() => startAsk()}>
        <Icon.sparkle size={16} /> {t("Ask AI")}</button>
      <button className="ib" title={t('生成阅读地图')} aria-label={t('生成阅读地图')} onClick={() => onTextMap(a.quote)}><Icon.globe /></button>
      <button type="button" className={'ib mark-mindmap' + (ready ? ' is-ready' : '')} data-mark-mindmap
        title={preparing ? t("正在保存划线…") : mapLabel} aria-label={mapLabel} disabled={preparing} aria-busy={preparing}
        onClick={() => void openMap()}>
        <Icon.mindmap size={20} />
        {ready && <span className="toc-mindmap-check" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="m2.5 6 2.2 2.2 4.8-4.8" /></svg></span>}
      </button>
      <button className="ib danger" title={t("Remove mark")} onClick={() => void removeMark(a.id)}>
        <Icon.trash />
      </button>
    </Floating>}
    </>
  )
}

function NoteTags({ tags, commitRef, onEscape, onChange }: {
  tags: string[]
  commitRef: { current: () => void }
  onEscape: () => void
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const tagsRef = useRef(tags)
  const draftRef = useRef(draft)
  const editValueRef = useRef(editValue)
  const editingRef = useRef<number | null>(null)
  const onChangeRef = useRef(onChange)

  const change = (next: string[]) => {
    tagsRef.current = next
    onChangeRef.current(next)
  }
  const commitDraft = () => {
    const raw = draftRef.current
    if (!raw.trim()) return
    draftRef.current = ''
    setDraft('')
    const next = addNoteTags(tagsRef.current, raw)
    if (next !== tagsRef.current) change(next)
  }
  const commitEdit = () => {
    const index = editingRef.current
    if (index === null) return
    editingRef.current = null
    setEditing(null)
    const next = replaceNoteTag(tagsRef.current, index, editValueRef.current)
    if (next !== tagsRef.current) change(next)
  }
  useEffect(() => {
    tagsRef.current = tags
    draftRef.current = draft
    editValueRef.current = editValue
    editingRef.current = editing
    onChangeRef.current = onChange
    commitRef.current = () => {
      commitEdit()
      commitDraft()
    }
  })

  const startEdit = (tag: string) => {
    commitEdit()
    commitDraft()
    const index = tagsRef.current.indexOf(tag)
    if (index < 0) return
    editingRef.current = index
    editValueRef.current = tagsRef.current[index]
    setEditing(index)
    setEditValue(tagsRef.current[index])
  }
  const press = useRef(0)
  const full = tags.length >= NOTE_TAG_LIMIT
  const onDraftChange = (value: string) => {
    const { ready, rest } = splitTagDraft(value)
    if (ready.length) {
      const next = addNoteTags(tagsRef.current, ready.join(','))
      if (next !== tagsRef.current) change(next)
      const leftover = next.length >= NOTE_TAG_LIMIT ? '' : tidyTagInput(rest)
      draftRef.current = leftover
      setDraft(leftover)
      return
    }
    const shown = tidyTagInput(value)
    draftRef.current = shown
    setDraft(shown)
  }

  return (
    <div
      className="note-tags"
      role="group"
      aria-label={full ? t("Tags, {0} of {1}", NOTE_TAG_LIMIT, NOTE_TAG_LIMIT) : t("Tags")}
      data-note-tags
      data-tag-count={tags.length}
    >
      {tags.map((tag, index) => editing === index ? (
        <label key={tag} className="note-tag-add">
          <span className="hash" aria-hidden>#</span>
          <input
            aria-label={t("Edit tag {0}", tag)}
            value={editValue}
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const shown = tidyTagInput(e.target.value)
              editValueRef.current = shown
              setEditValue(shown)
            }}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (isComposing(e)) return
              if (e.key === 'Enter') {
                e.preventDefault()
                commitEdit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                editingRef.current = null
                setEditing(null)
              }
            }}
          />
        </label>
      ) : (
        <span key={tag} className="note-tag" data-note-tag={tag}>
          <button
            type="button"
            className="note-tag-text"
            onPointerDown={(e) => { if (beginPress(e, press)) startEdit(tag) }}
            onMouseDown={(e) => { if (beginPress(e, press)) startEdit(tag) }}
          >
            <span className="hash" aria-hidden>#</span>{tag}
          </button>
          <button
            type="button"
            className="note-tag-remove"
            aria-label={t("Remove tag {0}", tag)}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            onClick={() => {
              commitEdit()
              const current = tagsRef.current
              const at = current.indexOf(tag)
              if (at >= 0) change(removeNoteTag(current, at))
            }}
          >
            <span aria-hidden>×</span>
          </button>
        </span>
      ))}
      {!full && (
        <label className="note-tag-add">
          <span className="hash" aria-hidden>#</span>
          <input
            aria-label={t("Add a tag")}
            data-note-tag-input
            value={draft}
            placeholder={t('tag')}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (isComposing(e)) return
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onEscape()
              } else if (e.key === 'Backspace' && !draft && tags.length) {
                e.preventDefault()
                change(removeNoteTag(tags, tags.length - 1))
              }
            }}
          />
        </label>
      )}
    </div>
  )
}

function DeleteNoteDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const el = dialog.current
    el?.showModal()
    cancel.current?.focus()
    return () => { el?.close() }
  }, [])
  return createPortal(
    <dialog
      ref={dialog}
      className="note-delete-dialog"
      aria-labelledby="note-delete-title"
      aria-describedby="note-delete-description"
      data-ui
      onCancel={(e) => { e.preventDefault(); onCancel() }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <h2 id="note-delete-title">{t("Delete this note?")}</h2>
      <p id="note-delete-description">{t("This note will be deleted. The highlighted text will remain.")}</p>
      <div className="note-delete-actions">
        <button ref={cancel} type="button" className="note-delete-cancel" onClick={onCancel}>{t("Cancel")}</button>
        <button type="button" className="note-delete-confirm" data-note-delete-confirm onClick={onConfirm}>{t("Delete note")}</button>
      </div>
    </dialog>,
    document.body,
  )
}

export function NoteEditor() {
  const id = useReader((s) => s.editingNote?.id)
  return id ? <InlineNoteEditor key={id} /> : null
}

function InlineNoteEditor() {
  const { editingNote, annotations, scene, updateNoteText, updateNoteTextColor, updateNoteFont, updateNoteTags, finishNoteEditing, removeNote } = useReader()
  const editor = useRef<HTMLDivElement>(null)
  const liveEditor = useRef<LiveNoteEditorHandle>(null)
  const tools = useRef<HTMLDivElement>(null)
  const commitTags = useRef<() => void>(() => {})
  const [menu, setMenu] = useState<null | 'color' | 'font' | 'more'>(null)
  const [confirming, setConfirming] = useState(false)
  const [fontBusy, setFontBusy] = useState(false)
  const [initialGeometry] = useState(initialNoteEditorGeometry)
  const geometry = useRef(initialGeometry)
  const a = annotations.find((x) => x.id === editingNote?.id)
  const id = a?.note ? a.id : undefined
  const tags = a?.note?.tags ?? []
  const textColor = noteTextColorOf(a?.note?.textColor)
  const ink = NOTE_TEXT_COLORS[textColor].ink
  const noteFont = noteFontIdOf(a?.note?.font)
  const noteText = a?.note?.text ?? ''
  useEffect(() => {
    if (noteFont === 'inherit') return
    let active = true
    const timer = setTimeout(() => {
      void ensureInlineNoteFont(noteFont, noteText).catch(() => {
        if (active) useReader.getState().say(t("笔记字体加载失败，请检查网络后重试。"))
      })
    }, 120)
    return () => { active = false; clearTimeout(timer) }
  }, [noteFont, noteText])
  const closeEditor = () => {
    commitTags.current()
    finishNoteEditing()
  }
  useEffect(() => {
    if (!menu) return
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && tools.current?.contains(event.target)) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenu(null)
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])
  useLayoutEffect(() => {
    if (!id || !scene) return
    const el = editor.current!
    let frame = 0
    let last = ''
    const place = () => {
      const rect = scene.noteScreenRect(id) ?? useReader.getState().editingNote?.rect
      const pose = rect ? { ...rect, left: rect.left, top: rect.top, width: rect.width, height: rect.height, rotation: 0 } : null
      if (pose) {
        const v = window.visualViewport
        const p = noteEditorLayout({ ...pose, ...geometry.current.anchor }, { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0, width: v?.width ?? window.innerWidth, height: v?.height ?? window.innerHeight }, geometry.current.size)
        const transform = `translate(${p.x}px, ${p.y}px)`
        const signature = `${transform}|${p.width}|${p.height}`
        if (signature !== last) {
          Object.assign(el.style, { transform, width: `${p.width}px`, height: `${p.height}px`, visibility: 'visible' })
          el.style.setProperty('--note-font', '17px')
          el.style.setProperty('--note-editor-height', `${p.height}px`)
          last = signature
        }
      }
      frame = requestAnimationFrame(place)
    }
    place()
    scene.setEditingNote(id)
    const onOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.note-editor, .note-delete-dialog, .inline-note-hit, [data-ui]')) return
      commitTags.current()
      useReader.getState().finishNoteEditing(false)
    }
    window.addEventListener('pointerdown', onOutside, true)
    const timer = setTimeout(() => liveEditor.current?.focus(), 30)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onOutside, true)
      scene.setEditingNote(null)
    }
  }, [id, scene, geometry])
  if (!editingNote || !a?.note) return null
  return (
    <div key={a.id} ref={editor} data-ui className="note-editor" role="dialog" aria-label={t("Edit inline note")} style={{ visibility: 'hidden' }} onMouseDown={(e) => e.preventDefault()}>
      <div className="note-quote" style={{ ['--note' as string]: '#faf7ef', ['--note-ink' as string]: '#62584b', ['--note-text' as string]: ink, ['--note-accent' as string]: ink, fontFamily: noteFontFamily(noteFont, scene?.pagination?.config.family ?? 'serif') }}>
        <span className="note-editor-label">{t('NOTE')}</span>
        <div ref={tools} className="note-tools">
          <button type="button" className="note-font-btn" data-note-font title={t("Note font")} disabled={fontBusy}
            aria-label={t("Note font, {0}", t(NOTE_FONTS.find(font => font.id === noteFont)!.label))} aria-haspopup="listbox" aria-expanded={menu === 'font'}
            onClick={() => setMenu(menu === 'font' ? null : 'font')}>{fontBusy ? '…' : 'Aa'}</button>
          {menu === 'font' && <div className="note-font-menu" role="listbox" aria-label={t("Note font")} onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')]
            const at = options.indexOf(document.activeElement as HTMLButtonElement)
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            options[index]?.focus()
          }}>
            {NOTE_FONTS.map(font => <button type="button" key={font.id} role="option" aria-selected={noteFont === font.id}
              data-note-font-option={font.id} disabled={fontBusy} onClick={() => {
                setMenu(null)
                if (font.id === noteFont) return
                setFontBusy(true)
                void updateNoteFont(a.id, font.id).finally(() => setFontBusy(false))
              }}><span>{t(font.label)}</span><small>{t(font.detail)}</small></button>)}
            <a href={localeUrl('/fonts/licenses.html')} target="_blank" rel="noopener noreferrer">{t("字体许可 · SIL OFL 1.1")}</a>
          </div>}
          <div className="note-color">
            <button
              type="button"
              className="note-color-btn"
              data-note-color={textColor}
              title={t("Note text color")}
              aria-label={t("Note text color, {0}", t(NOTE_TEXT_COLORS[textColor].label))}
              aria-haspopup="listbox"
              aria-expanded={menu === 'color'}
              onClick={() => setMenu(menu === 'color' ? null : 'color')}
            >
              <span className="sw on" style={{ ['--c' as string]: ink }} />
            </button>
            {menu === 'color' && (
              <div className="note-color-menu" role="listbox" aria-label={t("Note text color")}>
                {(Object.keys(NOTE_TEXT_COLORS) as NoteTextColor[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="option"
                    aria-selected={c === textColor}
                    data-note-color-option={c}
                    className={'sw' + (c === textColor ? ' on' : '')}
                    title={t(NOTE_TEXT_COLORS[c].label)}
                    aria-label={t(NOTE_TEXT_COLORS[c].label)}
                    style={{ ['--c' as string]: NOTE_TEXT_COLORS[c].ink }}
                    onClick={() => {
                      setMenu(null)
                      void updateNoteTextColor(a.id, c)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <button type="button" className="btn small note-done" data-note-done onClick={closeEditor}>{t("Done")}</button>
          <div className="note-more">
            <button
              type="button"
              className="note-more-btn"
              data-note-more
              title={t("Note actions")}
              aria-label={t("Note actions")}
              aria-haspopup="menu"
              aria-expanded={menu === 'more'}
              onClick={() => setMenu(menu === 'more' ? null : 'more')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
              </svg>
            </button>
            {menu === 'more' && (
              <div className="note-more-menu" role="menu" aria-label={t("Note actions")}>
                <button
                  type="button"
                  role="menuitem"
                  className="note-more-delete"
                  data-note-delete
                  onClick={() => { setMenu(null); setConfirming(true) }}
                >
                  <Icon.trash size={14} /> <span>{t("Delete note")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="note-markdown-live-hint">{t("Markdown · format as you type")}</div>
        <LiveNoteEditor ref={liveEditor} value={a.note.text} onChange={value => void updateNoteText(a.id, value)} onClose={closeEditor} />
        <NoteTags tags={tags} commitRef={commitTags} onEscape={closeEditor} onChange={(next) => void updateNoteTags(a.id, next)} />
        <div className="note-editor-footer"><NoteSaveStatus annotation={a} /><NoteResizeHandle editor={editor} onResize={next => { geometry.current = next }} /></div>
      </div>
      {confirming && <DeleteNoteDialog onCancel={() => setConfirming(false)} onConfirm={() => void removeNote(a.id)} />}
    </div>
  )
}
