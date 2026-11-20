import type { TextAtlasResult } from '../../../shared/textAtlas'
import { TagNotesDialog } from './TagNotesDialog'
import { FootnotePopover, type OpenFootnote } from './FootnotePopover'
import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { ReaderScene } from '../engine/scene'
import { useReader } from '../store/useReader'
import { AtlasDialog, type AtlasSelection } from './AtlasDialog'
import { ImagePreviewDialog } from './ImagePreviewDialog'
import { getStorageMode } from '../storage/mode'
import { bookIdFromPath } from '../route/bookPath'
import { passageFromHash, validatePassage } from '../route/passage'
import { AtlasDock, type AtlasDockHandle } from './AtlasDock'
import { mapAnchors, mergeLocatedMaps, type LocatedMap } from '../atlas/savedMaps'

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'hidden', 'image'])

export function DeskView({ recentTextMaps, excludedPlaceIds, atlasDockRef, onPlaceDeleted }: { excludedPlaceIds?: string[]; recentTextMaps?: TextAtlasResult[]; atlasDockRef: Ref<AtlasDockHandle>; onPlaceDeleted: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [imageOverlay, setImageOverlay] = useState<(AtlasSelection & { kind: 'preview' | 'atlas'; scene: ReaderScene }) | null>(null)
  const [footnote, setFootnote] = useState<OpenFootnote | null>(null)
  const [tagView, setTagView] = useState<{ tag: string; bookId: string; anchor: HTMLButtonElement } | null>(null)
  const current = useReader((s) => s.current)
  const session = useReader((s) => s.session)
  const scene = useReader((s) => s.scene)
  const [recognized, setRecognized] = useState<{ book: AtlasSelection['book']; entries: LocatedMap[] } | null>(null)
  const rememberMap = useCallback((selection: AtlasSelection, map: NonNullable<AtlasSelection['map']>) => {
    setRecognized(previous => ({ book: selection.book, entries: mergeLocatedMaps(previous?.book === selection.book ? previous.entries : [], mapAnchors(selection.book, selection.path, map)) }))
  }, [])

  useEffect(() => {
    const el = ref.current!
    const st = useReader.getState
    let resizeTimer = 0
    let resizePending = false, resizing = false, disposed = false
    const scheduleResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(flushResize, 240)
    }
    const flushResize = () => {
      if (disposed || !resizePending || resizing) return
      if (!scene.viewportNeedsReflow) { resizePending = false; return }
      const focused = document.activeElement
      const textInput = focused?.closest('textarea, [contenteditable="true"]') ||
        (focused instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(focused.type))
      // Keep the request while loading/typing; replay it once the blocker ends.
      if (st().loading || st().editingNote || textInput) return
      resizePending = false
      resizing = true
      void st().reflowNotes().finally(() => {
        resizing = false
        if (!disposed && resizePending) scheduleResize()
      })
    }
    const openImage = (path: string, map: AtlasSelection['map']) => {
      const current = st().current
      if (!current) return
      st().finishNoteEditing(false)
      st().setPopover(null)
      scene.clearSelection()
      setImageOverlay({ kind: 'preview', bookId: current.meta.id, book: current.parsed, path, map, scene, canRecognize: st().session.status === 'user' && getStorageMode() === 'api' })
    }
    const scene = new ReaderScene(el, {
      onReaderTap() {
        st().finishNoteEditing(false)
        st().setPopover(null)
        useReader.setState({ phoneControls: !st().phoneControls })
      },
      onViewportChange() {
        resizePending = true
        scheduleResize()
      },
      selectionText(locator) {
        const chapter = st().current?.parsed.chapters[locator.chapter]
        return chapter?.blocks.filter(block => !block.footnoteDefinition && block.start < locator.end && block.start + block.text.length > locator.start)
          .map(block => block.text.slice(Math.max(0, locator.start - block.start), Math.max(0, locator.end - block.start))).join('\n') ?? ''
      },
      onImageClick: openImage,
      onFootnoteClick(note, anchor) {
        st().finishNoteEditing(false)
        st().setPopover(null)
        setFootnote({ note, anchor })
      },
      onSelection(sel) {
        if (!sel) {
          if (st().popover) st().setPopover(null)
          return
        }
        const r = sel.rect
        st().setPopover({ kind: 'selection', locator: sel.locator, text: sel.text, rect: { left: r.left, top: r.top, width: r.width, height: r.height } })
      },
      onJudou(locator) {
        void st().toggleJudou(locator)
      },
      onTurned(turned, open) {
        const s = st()
        useReader.setState({ turned, open })
        if (s.current) void st().saveReadingProgress()
      },
      onMarkClick(id, rect) {
        st().setPopover({ kind: 'mark', id, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } })
      },
      onNoteTagClick(tag, anchor) {
        const current = st().current
        if (!current) return
        st().finishNoteEditing(false)
        st().setPopover(null)
        setTagView({ tag, bookId: current.meta.id, anchor })
      },
      onNoteClick(id, rect) {
        void st().editNote(id, { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      },
      onNoteMoved(id, x, y, rot) {
        st().moveNote(id, x, y, rot)
      },
      onBlankDeskClick() {
        st().finishNoteEditing(false)
      },
      onOpenChange(open) {
        st().finishNoteEditing(false)
        useReader.setState({ open, popover: null, editingNote: null })
      },
      onZoom(zoom) {
        useReader.setState({ zoom })
      },
      onTilt(tilt, persist, gesture) {
        st().syncTilt(tilt, persist)
        if (gesture) st().dismissTiltHint()
      },
    })
    useReader.getState().setScene(scene)
    ;(window as unknown as { __reader: ReaderScene; __store: typeof useReader }).__reader = scene
    ;(window as unknown as { __store: typeof useReader }).__store = useReader
    const unsubscribe = useReader.subscribe((state, previous) => {
      if ((state.loading !== previous.loading || state.editingNote !== previous.editingNote || state.current !== previous.current) &&
        (resizePending || scene.viewportNeedsReflow)) {
        resizePending = true
        scheduleResize()
      }
    })
    const onBlur = () => {
      if (resizePending || scene.viewportNeedsReflow) { resizePending = true; scheduleResize() }
    }
    document.addEventListener('focusout', onBlur)
    return () => {
      disposed = true
      window.clearTimeout(resizeTimer)
      unsubscribe()
      document.removeEventListener('focusout', onBlur)
      scene.dispose()
      useReader.getState().setScene(null)
    }
  }, [])

  useEffect(() => {
    const followPassageLink = () => {
      const { current, scene, loading, closeAsk } = useReader.getState()
      if (!current || !scene || loading || bookIdFromPath(location.pathname) !== current.meta.id) return
      const requested = passageFromHash(location.hash)
      const target = requested && validatePassage(requested, current.parsed.chapters)
      if (!target) return
      closeAsk()
      scene.clearSelection()
      scene.revealLocator(target)
    }
    followPassageLink()
    window.addEventListener('hashchange', followPassageLink)
    return () => window.removeEventListener('hashchange', followPassageLink)
  }, [current])

  return <><div ref={ref} className="desk" />
    {current && scene && <AtlasDock key={`${current.meta.id}:${session.status === 'user' ? session.user.id : session.status}:${getStorageMode()}`} bookId={current.meta.id} book={current.parsed}
      canRecognize={session.status === 'user' && getStorageMode() === 'api'} recent={recognized?.book === current.parsed ? recognized.entries : undefined}
      recentTextMaps={recentTextMaps} excludedPlaceIds={excludedPlaceIds} dockRef={atlasDockRef} onPlaceDeleted={onPlaceDeleted} />}
    {tagView && tagView.bookId === current?.meta.id && <TagNotesDialog tag={tagView.tag} bookId={tagView.bookId} anchor={tagView.anchor} onClose={() => setTagView(null)} />}
    {footnote && <FootnotePopover opened={footnote} onClose={() => setFootnote(null)} />}
    {imageOverlay && current?.parsed === imageOverlay.book && (imageOverlay.kind === 'preview'
      ? <ImagePreviewDialog key={`${imageOverlay.bookId}:${imageOverlay.path}`} book={imageOverlay.book} path={imageOverlay.path} scene={imageOverlay.scene} onClose={() => setImageOverlay(null)} onOpenMap={() => setImageOverlay((image) => image ? { ...image, kind: 'atlas' } : null)} />
      : <AtlasDialog key={`${imageOverlay.bookId}:${imageOverlay.path}`} selection={imageOverlay} scene={imageOverlay.scene} onRecognized={rememberMap} onClose={() => setImageOverlay(null)} onSignIn={() => { setImageOverlay(null); useReader.setState({ showLogin: true }) }} />)}
  </>
}
