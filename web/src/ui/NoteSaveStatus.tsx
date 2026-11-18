import { useSyncExternalStore } from 'react'
import type { Annotation } from '../book/annotations'
import { flushAnnotation, getAnnotationSaveState, getStorageMode, storage, subscribeAnnotationSaves } from '../storage'
import { t } from '../i18n'

export function NoteSaveStatus({ annotation }: { annotation: Annotation }) {
  const status = useSyncExternalStore(subscribeAnnotationSaves, () => getAnnotationSaveState(annotation.id))
  const cloud = getStorageMode() === 'api'
  const label = status === 'saving' ? (cloud ? t("正在自动同步…") : t("正在自动保存…"))
    : status === 'error' ? (cloud ? t("未同步，请重试") : t("保存失败，请重试"))
    : cloud ? t("已自动保存到云端") : t("已自动保存到此设备")
  return <div className="note-save-state" data-save-state={status}>
    <span role="status" aria-live="polite">{label}</span>
    {status === 'error' && <button type="button" onClick={() => {
      void storage.putAnnotation(annotation).then(() => flushAnnotation(annotation.id))
    }}>{t("重试")}</button>}
  </div>
}
