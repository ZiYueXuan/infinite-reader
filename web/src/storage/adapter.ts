import type { Annotation } from '../book/annotations'
import type { BookMeta } from '../book/types'

/**
 * Persistence boundary. The reader only talks to this interface, so the IndexedDB implementation (offline /
 * signed-out) and the HTTP one (see ApiAdapter, backend in worker/API.md) are interchangeable.
 */
export interface StorageAdapter {
  listBooks(): Promise<BookMeta[]>
  getBookFile(id: string): Promise<Blob | null>
  /** Stores the file and returns the persisted meta (a backend may assign its own id). */
  saveBook(meta: BookMeta, file: Blob): Promise<BookMeta>
  updateBook(id: string, patch: Partial<BookMeta>): Promise<void>
  deleteBook(id: string): Promise<void>
  listAnnotations(bookId: string): Promise<Annotation[]>
  /** Upsert. May be debounced/queued by the implementation. */
  putAnnotation(a: Annotation): Promise<void>
  deleteAnnotation(id: string, bookId: string): Promise<void>
}
