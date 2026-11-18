/** Client routes for the open book. The id is the one already stored for the book. */

const BOOK_PATH = /^\/book\/([^/]+)\/?$/
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const BOOK_UNAVAILABLE = "This book isn't available."

export interface BookHistoryState {
  bookId: string | null
  open: boolean
}

export type UrlLock = 'none' | 'hold' | 'keep'

export interface ReaderNav {
  open: boolean
  /** Id of the loaded book, even when the cover is closed. */
  bookId: string | null
  session: 'checking' | 'anon' | 'user' | 'local'
  urlLock: UrlLock
}

export type NavAction = { type: 'none' } | { type: 'push' | 'replace'; path: string; state: BookHistoryState }

/** Pull a stored book id out of a pathname, or null when the path is not a book route. */
export function bookIdFromPath(pathname: string): string | null {
  const m = BOOK_PATH.exec(pathname)
  if (!m) return null
  let id: string
  try {
    id = decodeURIComponent(m[1])
  } catch {
    return null
  }
  if (!ID_RE.test(id)) return null
  return UUID_RE.test(id) ? id.toLowerCase() : id
}

export function pathForBook(id: string): string {
  return `/book/${encodeURIComponent(id)}`
}

/**
 * How the address bar should change when the reader state changes.
 * A loaded book stays at `/book/<id>` whether the cover is open or closed.
 * Opening from `/shelf` pushes that path. A sample query, or an address that already names the book, is replaced.
 * Leaving the book pushes `/shelf`. A signed-out visitor, or a route still resolving, keeps a deep link.
 */
export function navForTransition(_prev: ReaderNav, next: ReaderNav, loc: { pathname: string; search: string }): NavAction {
  const desiredId = next.bookId
  if (desiredId) {
    const path = pathForBook(desiredId)
    const here = bookIdFromPath(loc.pathname)
    const sample = new URLSearchParams(loc.search).has('sample')
    if (here === desiredId && !loc.search) return { type: 'none' }
    if (here === desiredId || sample) return { type: 'replace', path, state: { bookId: desiredId, open: next.open } }
    return { type: 'push', path, state: { bookId: desiredId, open: next.open } }
  }
  if (!bookIdFromPath(loc.pathname)) return { type: 'none' }
  if (next.session === 'anon' || next.session === 'checking') return { type: 'none' }
  if (next.urlLock !== 'none') return { type: 'none' }
  return { type: 'push', path: '/shelf', state: { bookId: null, open: false } }
}
