export type AnnotationSaveState = 'saving' | 'saved' | 'error'

/** A response for an older draft must never mark a newer draft as saved. */
export class AnnotationSaveStateStore {
  private entries = new Map<string, { version: number; state: AnnotationSaveState }>()
  private listeners = new Set<() => void>()
  get = (id: string): AnnotationSaveState => this.entries.get(id)?.state ?? 'saved'
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  set(id: string, version: number, state: AnnotationSaveState) {
    const current = this.entries.get(id)
    if (current && current.version > version) return
    this.entries.set(id, { version, state })
    if (current?.state !== state) for (const listener of this.listeners) listener()
  }
}
