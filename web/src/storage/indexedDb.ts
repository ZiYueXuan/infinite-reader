import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Annotation } from '../book/annotations'
import type { BookMeta } from '../book/types'
import type { StorageAdapter } from './adapter'

interface Schema extends DBSchema {
  books: { key: string; value: BookMeta }
  files: { key: string; value: Blob }
  annotations: { key: string; value: Annotation; indexes: { byBook: string } }
}

export class IndexedDbAdapter implements StorageAdapter {
  private db: Promise<IDBPDatabase<Schema>>

  constructor(name = 'infinite-reader') {
    this.db = openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('books', { keyPath: 'id' })
        db.createObjectStore('files')
        const ann = db.createObjectStore('annotations', { keyPath: 'id' })
        ann.createIndex('byBook', 'bookId')
      },
    })
  }

  async listBooks() {
    const all = await (await this.db).getAll('books')
    return all.sort((a, b) => b.addedAt - a.addedAt)
  }

  async getBookFile(id: string) {
    return ((await (await this.db).get('files', id)) as Blob | undefined) ?? null
  }

  async saveBook(meta: BookMeta, file: Blob) {
    const db = await this.db
    const tx = db.transaction(['books', 'files'], 'readwrite')
    await tx.objectStore('books').put(meta)
    await tx.objectStore('files').put(file, meta.id)
    await tx.done
    return meta
  }

  async updateBook(id: string, patch: Partial<BookMeta>) {
    const db = await this.db
    const cur = await db.get('books', id)
    if (cur) await db.put('books', { ...cur, ...patch })
  }

  async deleteBook(id: string) {
    const db = await this.db
    const tx = db.transaction(['books', 'files', 'annotations'], 'readwrite')
    await tx.objectStore('books').delete(id)
    await tx.objectStore('files').delete(id)
    const keys = await tx.objectStore('annotations').index('byBook').getAllKeys(id)
    for (const k of keys) await tx.objectStore('annotations').delete(k)
    await tx.done
  }

  async listAnnotations(bookId: string) {
    return (await this.db).getAllFromIndex('annotations', 'byBook', bookId)
  }

  async putAnnotation(a: Annotation) {
    await (await this.db).put('annotations', a)
  }

  async deleteAnnotation(id: string, _bookId?: string) {
    void _bookId
    await (await this.db).delete('annotations', id)
  }
}
