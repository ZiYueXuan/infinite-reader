import { AnnotationSaveStateStore } from './annotationSaveState'
import type { StorageAdapter } from './adapter'
import { ApiAdapter } from './apiAdapter'
import { IndexedDbAdapter } from './indexedDb'

import { getStorageMode, setStorageMode } from './mode'

export { getStorageMode, setStorageMode }
export type { StorageMode } from './mode'

const local = new IndexedDbAdapter()
const remote = new ApiAdapter()
const localSaves = new AnnotationSaveStateStore()
let localVersion = 0
let syncError: ((error: unknown) => void) | undefined

/**
 * The adapter the rest of the app uses. It forwards to IndexedDB (signed out / offline / VITE_BACKEND=local) or to the
 * Worker API (signed in), and can be flipped at runtime with `setStorageMode` after login/logout.
 */
export const storage: StorageAdapter = {
  listBooks: () => active().listBooks(),
  getBookFile: (id) => active().getBookFile(id),
  saveBook: (m, f) => active().saveBook(m, f),
  updateBook: (id, p) => active().updateBook(id, p),
  deleteBook: (id) => active().deleteBook(id),
  listAnnotations: (b) => active().listAnnotations(b),
  putAnnotation: async (a) => {
    if (getStorageMode() === 'api') return remote.putAnnotation(a)
    const version = ++localVersion
    localSaves.set(a.id, version, 'saving')
    try {
      await local.putAnnotation(a)
      localSaves.set(a.id, version, 'saved')
    } catch (error) {
      localSaves.set(a.id, version, 'error')
      syncError?.(error)
    }
  },
  deleteAnnotation: (id, b) => active().deleteAnnotation(id, b),
}

function active(): StorageAdapter {
  return getStorageMode() === 'api' ? remote : local
}

export function onSyncError(fn: (e: unknown) => void) {
  remote.onError = fn
  syncError = fn
}

export function flushStorage() {
  return remote.flush()
}

export function getAnnotationSaveState(id: string) {
  return (getStorageMode() === 'api' ? remote.saves : localSaves).get(id)
}

export function subscribeAnnotationSaves(listener: () => void) {
  const local = localSaves.subscribe(listener), cloud = remote.saves.subscribe(listener)
  return () => { local(); cloud() }
}

export function flushAnnotation(id: string) {
  return getStorageMode() === 'api' ? remote.flushAnnotation(id) : Promise.resolve()
}
