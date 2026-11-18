import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark, imageSchema, remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { Plugin, Selection } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { noteLink } from '../book/noteMarkdown'
import { t, useLocale } from '../i18n'
import './note-markdown.css'
import './live-note-editor.css'

const externalChange = 'note:external-change'
// Standard Markdown blank lines, not HTML <br> placeholders in saved notes.
const noteCommonmark = commonmark.filter(plugin => !remarkPreserveEmptyLinePlugin.includes(plugin))
const empty = (doc: ProseNode) => doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph' && doc.firstChild.content.size === 0

export interface LiveNoteEditorHandle { focus(): void }
/** Milkdown owns parsing, input rules, caret movement, lists, history and composition.
 * This adapter only connects it to note storage, local UI preferences and shortcuts. */
export function LiveNoteEditor({ value, onChange, onClose, ref }: {
  value: string; onChange(value: string): void; onClose(): void; ref?: Ref<LiveNoteEditorHandle>
}) {
  const locale = useLocale()
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor | null>(null)
  const fallback = useRef<HTMLTextAreaElement>(null)
  const callbacks = useRef({ onChange, onClose })
  const source = useRef(value)
  const wantedFocus = useRef(false)
  const [failed, setFailed] = useState(false)
  useLayoutEffect(() => { callbacks.current = { onChange, onClose } }, [onChange, onClose])
  useImperativeHandle(ref, () => ({ focus() {
    wantedFocus.current = true
    if (fallback.current) fallback.current.focus()
    else editor.current?.action(ctx => ctx.get(editorViewCtx).focus())
  } }), [])

  useLayoutEffect(() => {
    let disposed = false
    const openingSource = source.current
    const instance = Editor.make().config(ctx => {
      ctx.set(rootCtx, host.current)
      ctx.set(defaultValueCtx, openingSource)
      ctx.update(remarkStringifyOptionsCtx, options => ({ ...options, bullet: '-' as const, emphasis: '*' as const, fences: true }))
      // Notes have always shown image links instead of fetching remote images.
      ctx.update(imageSchema.key, previous => context => ({ ...previous(context), toDOM(node) {
        const label = node.attrs.alt || node.attrs.src
        const href = noteLink(node.attrs.src)
        return href ? ['a', { href, target: '_blank', rel: 'noopener noreferrer', 'data-note-image': '' }, label] : ['span', label]
      } }))
      ctx.set(editorViewOptionsCtx, {
        attributes: { class: 'note-rich-content note-markdown', role: 'textbox', 'aria-label': t('Note text'), 'aria-multiline': 'true', 'data-placeholder': t('Write a note…'), spellcheck: 'true' },
        handleKeyDown(view, event) {
          if (event.isComposing || view.composing || event.key === 'Process') return false
          if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) {
            event.preventDefault(); callbacks.current.onClose(); return true
          }
          return false
        },
        dispatchTransaction(this: EditorView, transaction) {
          const result = this.state.applyTransaction(transaction)
          this.updateState(result.state)
          // Selection/format preference changes must not rewrite an existing note.
          if (disposed || !editor.current || !transaction.docChanged || transaction.getMeta(externalChange) || !result.transactions.length) return
          const markdown = empty(result.state.doc) ? '' : ctx.get(serializerCtx)(result.state.doc).replace(/\n$/, '')
          if (markdown !== source.current) { source.current = markdown; callbacks.current.onChange(markdown) }
        },
      })
    }).use(noteCommonmark).use(gfm).use(history).use(clipboard).use($prose(ctx => new Plugin({
      filterTransaction(transaction) {
        return !transaction.docChanged || !!transaction.getMeta(externalChange) || ctx.get(serializerCtx)(transaction.doc).replace(/\n$/, '').length <= 10000
      },
    })))
    void instance.create().then(() => {
      if (disposed) { void instance.destroy(); return }
      editor.current = instance
      instance.action(ctx => {
        const view = ctx.get(editorViewCtx)
        if (source.current !== openingSource) {
          const doc = ctx.get(parserCtx)(source.current)
          if (doc) view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta(externalChange, true).setMeta('addToHistory', false))
        }
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
        if (wantedFocus.current) view.focus()
      })
    }).catch(error => {
      if (import.meta.env.DEV) console.error('Note editor initialization failed', error)
      if (!disposed) setFailed(true) // Keep all original text editable if a legacy document cannot be parsed.
    })
    return () => {
      disposed = true
      editor.current = null
      if (instance.status === 'Created') void instance.destroy()
    }
  }, [])

  useLayoutEffect(() => {
    editor.current?.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.setProps({ attributes: { class: 'note-rich-content note-markdown', role: 'textbox', 'aria-label': t('Note text'), 'aria-multiline': 'true', 'data-placeholder': t('Write a note…'), spellcheck: 'true' } })
    })
  }, [locale])
  useLayoutEffect(() => {
    if (source.current === value) return
    source.current = value
    editor.current?.action(ctx => {
      const view = ctx.get(editorViewCtx), doc = ctx.get(parserCtx)(value)
      if (doc) view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta(externalChange, true).setMeta('addToHistory', false))
    })
  }, [value])
  return <div className="note-live-editor" data-note-live-editor data-note-engine="milkdown" onMouseDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div ref={host} className="note-rich-host" hidden={failed} />
    {failed && <>
      <p className="hint" role="status">{t('This note could not be opened in the rich editor. Your Markdown is preserved below.')}</p>
      <textarea ref={fallback} autoFocus value={value} maxLength={10000} aria-label={t('Note text')} onChange={event => { source.current = event.target.value; onChange(event.target.value) }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) { event.preventDefault(); onClose() }
      }} />
    </>}
  </div>
}
