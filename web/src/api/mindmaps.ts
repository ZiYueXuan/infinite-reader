import { useEffect, useState } from 'react'
import type { MindmapIndex } from '../../../shared/mindmap'
import { api } from './http'

const SAVED = 'ir:mindmap-saved'
export function notifyMindmapSaved(bookId: string, target: string) {
  window.dispatchEvent(new CustomEvent(SAVED, { detail: { bookId, target } }))
}

/** Read once per open/book/account; refresh pending jobs and on return to this tab. */
export function useReadyMindmaps(bookId: string | undefined, userId: string | undefined) {
  const key = `${userId ?? ''}:${bookId ?? ''}`
  const [snapshot, setSnapshot] = useState<{ key: string; targets: Set<string> } | null>(null)
  useEffect(() => {
    if (!bookId || !userId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    const localReady = new Set<string>()
    const refresh = async () => {
      if (busy || document.hidden || controller.signal.aborted) return
      busy = true
      clearTimeout(timer)
      try {
        const index = await api<MindmapIndex>(`/books/${encodeURIComponent(bookId)}/mindmaps`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setSnapshot({ key, targets: new Set([...index.readyTargets, ...localReady]) })
        if (index.pending) timer = setTimeout(() => void refresh(), 5000)
      } catch { /* Unknown state remains neutral; opening a map can still read its saved result. */ }
      finally { busy = false }
    }
    const saved = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId: string; target: string }>).detail
      if (detail.bookId !== bookId) return
      localReady.add(detail.target)
      setSnapshot(previous => ({ key, targets: new Set([...(previous?.key === key ? previous.targets : []), ...localReady]) }))
    }
    void refresh()
    window.addEventListener(SAVED, saved)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort(); clearTimeout(timer)
      window.removeEventListener(SAVED, saved)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [bookId, userId, key])
  return snapshot?.key === key ? snapshot.targets : undefined
}
