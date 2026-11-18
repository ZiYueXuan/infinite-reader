import { isLandingRoute } from './entry'
import { bookIdFromPath, navForTransition, type ReaderNav } from './bookPath'
import { historyLocked, runHistoryNav } from './historyLock'
import { useReader, type Session } from '../store/useReader'

function sessionKind(session: Session): ReaderNav['session'] {
  return session.status
}

function snapshot(state: ReturnType<typeof useReader.getState>): ReaderNav {
  return {
    open: state.open,
    bookId: state.current?.meta.id ?? null,
    session: sessionKind(state.session),
    urlLock: state.urlLock,
  }
}

let installed = false

/** Keep `/book/<id>` in step with the loaded book, and teach back/forward to reopen it or return to the shelf. */
export function installBookHistory() {
  if (installed || typeof window === 'undefined') return
  installed = true
  let last = snapshot(useReader.getState())
  useReader.subscribe((state) => {
    const prev = last
    const next = snapshot(state)
    last = next
    if (historyLocked()) return
    const action = navForTransition(prev, next, { pathname: location.pathname, search: location.search })
    if (action.type === 'none') return
    history[action.type === 'push' ? 'pushState' : 'replaceState'](action.state, '', action.path)
  })
  window.addEventListener('popstate', () => {
    // A history entry from the public site belongs to a separate, lightweight shell.
    if (isLandingRoute(location.pathname, location.search)) { location.reload(); return }
    runHistoryNav(() => {
      const id = bookIdFromPath(location.pathname)
      const st = useReader.getState()
      if (id) {
        if (st.session.status === 'anon' || st.session.status === 'checking') return
        if (st.current?.meta.id === id) {
          if (!st.open) st.scene?.setOpen(true)
          return
        }
        void st.openFromRoute(id)
        return
      }
      st.returnToShelf()
    })
  })
}
