import { t, errorText } from '../i18n'
import { useEffect, useState } from 'react'
import { canImportBook, useReader } from '../store/useReader'
import { Icon } from './icons'

export function TurnHint() {
  const { open, leafCount, scene, turnHintSeen, current, loading, dismissTurnHint } = useReader()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!open || turnHintSeen || !scene || !current || loading || !leafCount) return
    let shown = false
    const timers: number[] = []
    const finish = () => {
      setOn(false)
      if (shown) dismissTurnHint()
      window.removeEventListener('pointerdown', finish, true)
      window.removeEventListener('keydown', finish, true)
    }
    let tries = 0
    const probe = window.setInterval(() => {
      if (++tries > 14) {
        clearInterval(probe)
        return
      }
      const at = scene.pagePoint(1, 0.84, 0.02)
      if (!at || !scene.flutterCorner()) return
      clearInterval(probe)
      shown = true
      setPos({ x: Math.min(window.innerWidth - 150, Math.max(150, at.x)), y: Math.min(window.innerHeight - 118, Math.max(90, at.y - 22)) })
      setOn(true)
      window.addEventListener('pointerdown', finish, true)
      window.addEventListener('keydown', finish, true)
      timers.push(
        window.setTimeout(() => shown && scene.flutterCorner(), 3300),
        window.setTimeout(finish, 8800),
      )
    }, 700)
    timers.push(probe)
    return () => {
      timers.forEach((t) => {
        clearTimeout(t)
        clearInterval(t)
      })
      setOn(false)
      window.removeEventListener('pointerdown', finish, true)
      window.removeEventListener('keydown', finish, true)
    }
  }, [open, turnHintSeen, scene, current, loading, leafCount, dismissTurnHint])

  if (!pos) return null
  return (
    <div className={'turn-hint' + (on ? ' on' : '')} style={{ left: pos.x, top: pos.y }} aria-hidden={!on}>
      <span>{t("Drag the corner or press")}</span>
      <kbd>←</kbd>
      <kbd>→</kbd>
    </div>
  )
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** one-time hint after the turn hint: how to tilt the view; any tilt gesture dismisses it for good */
export function TiltHint() {
  const { open, leafCount, turnHintSeen, tiltHintSeen, current, loading, scene, dismissTiltHint } = useReader()
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!open || !turnHintSeen || tiltHintSeen || !scene || !current || loading || !leafCount) return
    let shown = false
    const timers: number[] = []
    timers.push(
      window.setTimeout(() => {
        shown = true
        setOn(true)
      }, 1800),
      window.setTimeout(() => {
        setOn(false)
        if (shown) dismissTiltHint()
      }, 11000),
    )
    return () => {
      timers.forEach((t) => clearTimeout(t))
      setOn(false)
    }
  }, [open, turnHintSeen, tiltHintSeen, scene, current, loading, leafCount, dismissTiltHint])

  const visible = on && !tiltHintSeen
  return (
    <div className={'tilt-hint' + (visible ? ' on' : '')} aria-hidden={!visible} role="status">
      <span>{t("Right-drag to tilt the view")}</span>
      <span className="alt">{IS_MAC ? t("⌥ drag on a trackpad") : t("Alt-drag on a trackpad")}</span>
      <kbd>T</kbd>
    </div>
  )
}

export function Loading() {
  const { loading } = useReader()
  if (!loading) return null
  return (
    <div className="loading" data-ui>
      <div className="spinner" />
      <div className="lbl">{t(loading.label)}</div>
      <div className="bar">
        <i style={{ width: `${Math.round(loading.progress * 100)}%` }} />
      </div>
    </div>
  )
}

export function Toast() {
  const { toast } = useReader()
  return <div className={'toast' + (toast ? ' show' : '')}>{toast ? errorText(toast) : ''}</div>
}

export function DropZone() {
  const [over, setOver] = useState(false)
  const openBlob = useReader((s) => s.openBlob)
  const sessionStatus = useReader((s) => s.session.status)
  const canAdd = sessionStatus === 'user' && canImportBook()
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setOver(true)
    }
    const over_ = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => /\.epub$/i.test(x.name) || x.type === 'application/epub+zip')
      if (f) void openBlob(f, f.name)
      else useReader.getState().say(t("That is not an EPUB file"))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over_)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over_)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [openBlob])
  return (
    <div className={'dropzone' + (over ? ' on' : '')}>
      <div className="inner">
        <Icon.upload size={34} />
        <b>{canAdd ? t("Drop your EPUB on the desk") : t("Sign in to add a book.")}</b>
      </div>
    </div>
  )
}
