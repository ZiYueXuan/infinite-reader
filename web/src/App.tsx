import { t, useLocale } from './i18n'
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import '@fontsource-variable/eb-garamond'
import '@fontsource-variable/inter'
import { SHELF_BACKGROUNDS } from './ui/shelfBackgrounds'
import { bookIdFromPath } from './route/bookPath'
import { installBookHistory } from './route/bookHistory'
import { Loading, Toast, DropZone, TurnHint, TiltHint } from './ui/Overlays'
import { Shelf, ShelfUp } from './ui/Shelf'
import { AccountChip, LoginCard } from './ui/Login'
import { CostDebugWindow } from './ui/CostDebugWindow'
import { useReader } from './store/useReader'

const ReaderWorkspace = lazy(() => import('./ui/ReaderWorkspace'))

class ReaderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() {
    useReader.setState({ loading: null, error: t("Could not open the book") })
  }
  render() {
    return this.state.failed ? <div className="loading" role="alert" data-ui>
      <p>{t("Could not open the book")}</p>
      <button className="btn" onClick={() => location.reload()}>{t("Try again")}</button>
    </div> : this.props.children
  }
}

let booted = false

export default function App() {
  const locale = useLocale()
  useEffect(() => {
    // Repaginate UI placeholders and regenerate canvas textures without changing content.
    void useReader.getState().reflowNotes()
  }, [locale])
  const desk = useReader((s) => s.desk)
  const session = useReader((s) => s.session)
  const showLogin = useReader((s) => s.showLogin)
  const current = useReader((s) => s.current)
  const phone = useReader((s) => s.scene?.phone ?? false)
  useEffect(() => { document.title = current ? `${current.meta.title} · Infinite Reader` : 'Infinite Reader' }, [current])
  const [costs, setCosts] = useState({ location: '', open: false })
  const costLocation = `${session.status === 'user' ? session.user.id : session.status}:${current?.meta.id ?? 'shelf'}`
  // Close on page/account changes without remounting the observation state.
  if (costs.location !== costLocation) setCosts({ location: costLocation, open: false })
  const costsOpen = costs.location === costLocation && costs.open
  const setCostsOpen = (open: boolean) => setCosts({ location: costLocation, open })
  const loading = useReader((s) => s.loading)
  const error = useReader((s) => s.error)
  const checkingShelf = session.status === 'checking' && !bookIdFromPath(location.pathname)
  const shelfVisible = (checkingShelf || session.status === 'user' || session.status === 'local') && !showLogin && !current && !loading
  // Keep the mounted scene when returning to the shelf; create it only on the first book open.
  const [readerStarted, setReaderStarted] = useState(false)
  const needsReader = !!current || !!loading
  if (needsReader && !readerStarted) setReaderStarted(true)
  useEffect(() => {
    if (booted) return
    booted = true
    ;(window as unknown as { __store: typeof useReader }).__store = useReader
    installBookHistory()
    void useReader.getState().initSession()
  }, [])
  return (
    <div className="app" data-phone-reading={phone && !!current || undefined} style={{ background: `center / cover url("${SHELF_BACKGROUNDS[desk]}")` }}>
      {readerStarted && <ReaderBoundary><Suspense fallback={null}><ReaderWorkspace /></Suspense></ReaderBoundary>}
      {!phone && <ShelfUp />}
      {shelfVisible && <Shelf onOpenCosts={() => setCostsOpen(true)} />}
      {!shelfVisible && !(phone && current) && <AccountChip onOpenCosts={() => setCostsOpen(true)} />}
      <LoginCard />
      {!phone && <TurnHint />}
      {!phone && <TiltHint />}
      {!error && <Loading />}
      <Toast />
      <CostDebugWindow reading={!!current} open={costsOpen} onClose={() => setCostsOpen(false)} />
      <DropZone />
    </div>
  )
}
