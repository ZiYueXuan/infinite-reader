import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useReader } from '../store/useReader'
import { Icon } from './icons'

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => void | Promise<void>
}
type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> }
const fullscreenDocument = () => document as FullscreenDocument
const isActive = () => !!(document.fullscreenElement || fullscreenDocument().webkitFullscreenElement)
function isSupported() {
  const root = document.documentElement as FullscreenRoot
  return typeof root.requestFullscreen === 'function'
    ? document.fullscreenEnabled !== false
    : typeof root.webkitRequestFullscreen === 'function' && fullscreenDocument().webkitFullscreenEnabled !== false
}

/** Fullscreen the document so the reader, notes and dialogs remain in the same viewport. */
export function FullscreenControl() {
  const t = useT()
  const [active, setActive] = useState(isActive)
  const [supported, setSupported] = useState(isSupported)
  const [pending, setPending] = useState(false)
  const busy = useRef(false), mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    const sync = () => { setActive(isActive()); setSupported(isSupported()) }
    // Also follows Escape / the browser's own fullscreen controls, rather than assuming a click succeeded.
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      mounted.current = false
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])
  const toggle = async () => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    const wasActive = isActive(), doc = fullscreenDocument(), root = document.documentElement as FullscreenRoot
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen()
      else if (doc.webkitFullscreenElement) await doc.webkitExitFullscreen?.()
      else if (root.requestFullscreen) await root.requestFullscreen()
      else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen()
      else throw new Error('Fullscreen unavailable')
    } catch {
      useReader.getState().say(wasActive ? t('Could not exit fullscreen. Please try again.') : t('Could not enter fullscreen. Please try again.'))
    } finally {
      busy.current = false
      if (mounted.current) { setPending(false); setActive(isActive()); setSupported(isSupported()) }
    }
  }
  const label = !supported && !active ? t('Fullscreen is not supported by this browser') : active ? t('Exit fullscreen (Esc)') : t('Enter fullscreen')
  return <button type="button" className={'ib fullscreen-toggle' + (active ? ' on' : '')} title={label} aria-label={label}
    aria-pressed={active} disabled={pending || (!supported && !active)} onClick={() => void toggle()}>
    {active ? <Icon.shrink /> : <Icon.fit />}
  </button>
}
