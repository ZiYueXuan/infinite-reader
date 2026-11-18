import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TextAtlasPlace } from '../../../shared/textAtlas'
import { deleteTextPlace } from '../api/atlas'
import { t } from '../i18n'
import './text-atlas.css'

/** Shared saved-place controls for the dialog and the anchored reader map. */
export function TextAtlasPlaces({ bookId, places, selected, onSelect, onDeleted }: {
  bookId: string; places: TextAtlasPlace[]; selected: string | null
  onSelect: (id: string) => void; onDeleted: (id: string) => void
}) {
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const [deleting, setDeleting] = useState<TextAtlasPlace | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const deleteLock = useRef(false)
  const [deleteError, setDeleteError] = useState('')
  const remove = async () => {
    if (!deleting || deleteLock.current) return
    deleteLock.current = true; setDeleteBusy(true); setDeleteError('')
    try {
      await deleteTextPlace(bookId, deleting.id)
      onDeleted(deleting.id)
      if (active.current) { setDeleting(null) }
    } catch {
      if (active.current) setDeleteError(t('删除失败，请重试。地点仍保留。'))
    } finally { deleteLock.current = false; if (active.current) setDeleteBusy(false) }
  }
  return <>
    <div className="atlas-places">
      {places.map(p => <div key={p.id} className="text-atlas-place-entry" data-text-place-id={p.id}>
        <div className="text-atlas-place-row">
          <button aria-pressed={selected === p.id} onClick={() => onSelect(p.id)}>
            <span>{p.name}<small>{p.modernName}</small>
              {p.historicalAlias && <small>{t('历史别名；标注为地名库中的对应位置')}</small>}
            </span>
          </button>
          <button className="text-atlas-delete" aria-label={t('删除地点“{0}”', p.name)} title={t('删除地点“{0}”', p.name)}
            onClick={() => { setDeleteError(''); setDeleting(p) }}>{t('删除')}</button>
        </div>
        <a className="text-atlas-source" href={p.sourceUrl} target="_blank" rel="noreferrer">{p.source} · {t('查看来源')}</a>
      </div>)}
    </div>
    {deleting && <DeletePlaceConfirmation name={deleting.name} busy={deleteBusy} error={deleteError}
      onCancel={() => { if (!deleteLock.current) setDeleting(null) }} onConfirm={() => void remove()} />}
  </>
}

function DeletePlaceConfirmation({ name, busy, error, onCancel, onConfirm }: { name: string; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = ref.current!
    element.showModal(); cancel.current?.focus()
    return () => { element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} className="text-atlas-delete-confirm" aria-labelledby="delete-place-title" aria-describedby="delete-place-description"
    onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel() }}>
    <h2 id="delete-place-title">{t('删除地点“{0}”？', name)}</h2>
    <p id="delete-place-description">{t('将从本书所有文字地图中移除此地点，包括本段地图和文字地点汇总。重新打开或识别不会自动恢复，不影响图片地图。')}</p>
    {error && <p role="alert">{error}</p>}
    <div className="text-atlas-actions"><button ref={cancel} disabled={busy} onClick={onCancel}>{t('取消')}</button>
      <button className="text-atlas-danger" disabled={busy} onClick={onConfirm}>{t(busy ? '正在删除…' : '确认删除')}</button></div>
  </dialog>
}
