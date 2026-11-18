import { openDB, type IDBPDatabase } from 'idb'
import type { Annotation } from '../book/annotations'

/**
 * Write-ahead log for annotation / sticky-note writes that have not been confirmed by the server yet.
 *
 * Every `putAnnotation` / `deleteAnnotation` is recorded here immediately (before the debounce) and removed once the server
 * accepted it, so a reload, crash or failed unload flush cannot lose it: the next load replays whatever is still here.
 * The in-memory map is the source of truth at runtime. It is persisted to IndexedDB and, because an IndexedDB commit started in
 * the last milliseconds before an unload is not guaranteed to finish, also mirrored synchronously to localStorage.
 */
export interface OutboxEntry {
  id: string
  bookId: string
  op: 'put' | 'delete'
  a?: Annotation
  /** monotonically increasing version (ms timestamp) so a stale removal never drops a newer write */
  v: number
}

const LS_KEY = 'infinite-reader:outbox:v1'

export class Outbox {
  private mem = new Map<string, OutboxEntry>()
  private handle: IDBPDatabase | null = null
  private seq = 0
  readonly ready: Promise<void>

  constructor(name = 'infinite-reader-outbox') {
    this.ready = this.load(name)
  }

  private async load(name: string) {
    const merge = (e: OutboxEntry) => {
      const cur = this.mem.get(e.id)
      if (!cur || cur.v < e.v) this.mem.set(e.id, e)
    }
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      if (raw) for (const e of JSON.parse(raw) as OutboxEntry[]) merge(e)
    } catch {
      /* corrupt or unavailable */
    }
    try {
      this.handle = await openDB(name, 1, { upgrade: (db) => void db.createObjectStore('entries', { keyPath: 'id' }) })
      for (const e of (await this.handle.getAll('entries')) as OutboxEntry[]) merge(e)
      // anything recorded while IndexedDB was still opening
      for (const e of this.mem.values()) void this.handle.put('entries', e).catch(() => undefined)
    } catch {
      /* private mode etc.: localStorage mirror still works */
    }
  }

  nextVersion() {
    this.seq = Math.max(this.seq + 1, Date.now())
    return this.seq
  }

  private mirror() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...this.mem.values()]))
    } catch {
      /* quota / unavailable */
    }
  }

  put(e: OutboxEntry) {
    this.mem.set(e.id, e)
    this.mirror()
    if (this.handle) void this.handle.put('entries', e).catch(() => undefined)
  }

  /** drop an entry once the server has it; a newer write to the same id is kept */
  remove(id: string, v: number) {
    const cur = this.mem.get(id)
    if (!cur || cur.v > v) return
    this.mem.delete(id)
    this.mirror()
    if (this.handle) void this.handle.delete('entries', id).catch(() => undefined)
  }

  snapshot(bookId?: string): OutboxEntry[] {
    return [...this.mem.values()].filter((e) => !bookId || e.bookId === bookId)
  }
}
