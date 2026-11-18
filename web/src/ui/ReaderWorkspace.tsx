import { DeskView } from './DeskView'
import { Toolbar } from './Toolbar'
import { LibraryDrawer, TocDrawer } from './Drawers'
import { MarkPopover, NoteEditor, SelectionPopover } from './Popovers'
import { AskPanel } from './AskPanel'
import { useReader } from '../store/useReader'
import { useRef, useState } from 'react'
import type { AtlasDockHandle } from './AtlasDock'
import { TextAtlasDialog } from './TextAtlasDialog'
import { TEXT_ATLAS_MAX_CHARS, type TextAtlasResult } from '../../../shared/textAtlas'
import { t } from '../i18n'

/** Loaded on the first book open, never needed to browse the shelf. */
export default function ReaderWorkspace() {
  const panel = useReader(s => s.panel)
  const session = useReader(s => s.session)
  const current = useReader(s => s.current)
  const scene = useReader(s => s.scene)
  const owner = `${current?.meta.id ?? ''}:${session.status === 'user' ? session.user.id : session.status}`
  const [textMap, setTextMap] = useState<{ owner: string; text: string } | null>(null)
  const [savedTextMap, setSavedTextMap] = useState<{ owner: string; results: TextAtlasResult[] } | null>(null)
  const [excluded, setExcluded] = useState<{ owner: string; ids: string[] } | null>(null)
  const atlasDock = useRef<AtlasDockHandle>(null)
  const excludedPlaceIds = excluded?.owner === owner ? excluded.ids : undefined
  const isCurrentOwner = () => {
    const state = useReader.getState()
    return state.current?.meta.id === current?.meta.id && state.session.status === 'user' && session.status === 'user' && state.session.user.id === session.user.id
  }
  const placeDeleted = (id: string) => {
    if (isCurrentOwner()) setExcluded(previous => ({ owner, ids: [...new Set([...(previous?.owner === owner ? previous.ids : []), id])] }))
  }
  const openTextMap = (text: string) => {
    if (!current?.meta.status || session.status !== 'user') { useReader.getState().say(t('请登录并打开已上传的书籍，再生成阅读地图。')); return }
    if (text.trim().length < 2 || text.trim().length > TEXT_ATLAS_MAX_CHARS) { useReader.getState().say(t('请选择 2 至 6000 字的原文。')); return }
    setTextMap({ owner, text: text.trim() })
    useReader.getState().setPopover(null)
  }
  return <>
    <DeskView excludedPlaceIds={excludedPlaceIds} recentTextMaps={savedTextMap?.owner === owner ? savedTextMap.results : undefined}
      atlasDockRef={atlasDock} onPlaceDeleted={placeDeleted} />
    <Toolbar />
    {panel === 'library' && <LibraryDrawer />}
    {panel === 'toc' && <TocDrawer />}
    <SelectionPopover onTextMap={openTextMap} />
    <MarkPopover key={owner} onTextMap={openTextMap} />
    {textMap?.owner === owner && current && <TextAtlasDialog key={owner + ':' + textMap.text} bookId={current.meta.id} text={textMap.text} scene={scene}
      excludedPlaceIds={excludedPlaceIds}
      onRecognized={(result, present) => {
        if (!isCurrentOwner()) return false
        setSavedTextMap(previous => {
          const id = result.cacheId ?? result.map?.id
          const results = (previous?.owner === owner ? previous.results : []).filter(r => (r.cacheId ?? r.map?.id) !== id)
          return { owner, results: [...results, result] }
        })
        return present && !!atlasDock.current?.presentTextResult(result)
      }} onClose={() => setTextMap(null)} />}
    <NoteEditor />
    <AskPanel />
  </>
}
