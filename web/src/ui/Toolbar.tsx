import { t } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TILT_MAX, TILT_MIN, TILT_PRESETS } from '../settings'
import { useReader } from '../store/useReader'
import { FullscreenControl } from './FullscreenControl'
import { AppearanceControl } from './AppearanceControl'
import { Icon } from './icons'
import './toolbar.css'
import { PhoneToolbar } from './PhoneToolbar'

function TiltControl({ openMenu, onOpenChange }: { openMenu: boolean; onOpenChange: (open: boolean) => void }) {
  const tilt = useReader((s) => s.tilt)
  const setTilt = useReader((s) => s.setTilt)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return
    const away = (e: PointerEvent) => {
      if (e.button === 2 || e.altKey) return
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [openMenu, onOpenChange])

  const active = TILT_PRESETS.find((p) => Math.abs(p.value - tilt) < 0.03)
  return (
    <div className="tilt-wrap" ref={ref}>
      <button className={'ib' + (openMenu ? ' on' : '')} title={t("Viewing angle: right-drag or Alt/Option-drag the desk, press T to cycle presets")} aria-label={t("Viewing angle")} onClick={() => onOpenChange(!openMenu)}>
        <Icon.tilt />
      </button>
      {openMenu && (
        <div className="tilt-pop" data-ui role="dialog" aria-label={t("Viewing angle")} onMouseDown={(e) => e.stopPropagation()}>
          <div className="tilt-title">{t("Viewing angle")}</div>
          <div className="tilt-presets">
            {TILT_PRESETS.map((p) => (
              <button
                key={p.id}
                className={'chip' + (active?.id === p.id ? ' on' : '')}
                title={p.id === 'default' ? t("Reset the viewing angle (T cycles presets)") : t(p.label)}
                onClick={() => setTilt(p.value)}
              >
                <i className={'tilt-glyph ' + p.id} />
                {t(p.label)}
              </button>
            ))}
          </div>
          <input
            className="tilt-slider"
            type="range"
            min={TILT_MIN}
            max={TILT_MAX}
            step={0.01}
            value={tilt}
            aria-label={t("Tilt")}
            onChange={(e) => setTilt(parseFloat(e.target.value), false)}
          />
          <div className="tilt-ends">
            <span>{t("Flat")}</span>
            <span>{Math.round((tilt * 180) / Math.PI)}°</span>
            <span>{t("Oblique")}</span>
          </div>
          <div className="tilt-tip">{t("Right-drag or Alt/Option-drag the desk. Press")} <kbd>T</kbd> {t("to cycle presets.")}</div>
        </div>
      )}
    </div>
  )
}

export function Toolbar() {
  const current = useReader(s => s.current)
  const phone = useReader(s => s.scene?.phone)
  if (phone) return current ? <PhoneToolbar key={current.meta.id} /> : null
  return current ? <ReadingToolbar key={current.meta.id} /> : null
}

const IDLE_DELAY = 4000

function ReadingToolbar() {
  const { current, open, turned, leafCount, panel, setPanel, scene, zoom, loading, showLogin } = useReader()
  // Reveal the controls on every reading session so readers can discover them.
  const [expanded, setExpanded] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pressing, setPressing] = useState(false)
  const unavailable = !!loading || showLogin
  const [menu, setMenu] = useState<'tilt' | 'appearance' | null>(null)
  const tiltMenu = menu === 'tilt'
  const setTiltMenu = useCallback((value: boolean) => setMenu(current => value ? 'tilt' : current === 'tilt' ? null : current), [])
  const setAppearanceMenu = useCallback((value: boolean) => setMenu(current => value ? 'appearance' : current === 'appearance' ? null : current), [])
  const root = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const indicator = useRef<HTMLButtonElement>(null)
  const collapse = useCallback(() => {
    // Never leave keyboard focus inside controls that are about to become inert.
    if (dock.current?.contains(document.activeElement)) indicator.current?.focus({ preventScroll: true })
    setExpanded(false)
    setMenu(null)
    setHovered(false)
    setFocused(false)
    setPressing(false)
  }, [])

  useEffect(() => {
    // Removing a focused slider/menu does not always dispatch blur in browsers.
    const frame = requestAnimationFrame(() => {
      if (unavailable) { setHovered(false); setPressing(false) }
      setFocused(!!dock.current?.contains(document.activeElement))
    })
    return () => cancelAnimationFrame(frame)
  }, [expanded, menu, unavailable])

  useEffect(() => {
    if (unavailable || !expanded || hovered || focused || pressing || menu) return
    const timer = window.setTimeout(collapse, IDLE_DELAY)
    return () => clearTimeout(timer)
  }, [unavailable, expanded, hovered, focused, pressing, menu, collapse])

  useEffect(() => {
    if (!expanded || unavailable) return
    const release = () => setPressing(false)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', release)
    const outside = (event: PointerEvent) => {
      // Keep the angle controls available while right/Option-dragging the desk.
      if (tiltMenu && (event.button === 2 || event.altKey)) return
      if (event.target instanceof Node && !root.current?.contains(event.target)) collapse()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return
      // A text editor owns its Escape key; do not disturb it or steal its focus.
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      collapse()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', release)
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape)
    }
  }, [expanded, unavailable, tiltMenu, collapse])

  const progress = leafCount ? Math.min(1, turned / leafCount) : 0
  const hasBook = !!current
  if (!current || unavailable) return null

  return (
    <div ref={root} className="reader-dock" data-expanded={expanded} data-menu={menu ?? undefined} data-ui
      onMouseDown={e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault() }}>
      <button ref={indicator} type="button" className="dock-indicator" aria-expanded={expanded} aria-controls="reading-toolbar"
        aria-label={expanded ? t('Hide reading controls') : t('Show reading controls')}
        title={expanded ? t('Hide reading controls') : t('Show reading controls')}
        onClick={event => {
          if (expanded) collapse()
          else {
            setExpanded(true)
            if (event.detail === 0) requestAnimationFrame(() => dock.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }))
          }
        }}>
        <span className="dock-indicator-pill" aria-hidden="true"><span /></span>
      </button>
    <div ref={dock} id="reading-toolbar" className="dock" role="group" aria-label={t('Reading controls')}
      inert={!expanded} aria-hidden={!expanded}
      onPointerDownCapture={() => setPressing(true)}
      onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true) }}
      onPointerLeave={event => { if (event.pointerType !== 'touch') setHovered(false) }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation()
          if (menu) {
            setMenu(null)
            dock.current?.querySelector<HTMLButtonElement>(menu === 'tilt' ? '.tilt-wrap > button' : '.appearance-menu > button')?.focus()
          }
          else collapse()
        }
      }}>
      <button className={'ib' + (panel === 'library' ? ' on' : '')} title={t("Library")} onClick={() => setPanel(panel === 'library' ? 'none' : 'library')}>
        <Icon.library />
      </button>
      <button className={'ib' + (panel === 'toc' ? ' on' : '')} title={t("Contents & marks")} disabled={!hasBook} onClick={() => setPanel(panel === 'toc' ? 'none' : 'toc')}>
        <Icon.list />
      </button>
      <span className="sep" />
      <button className="ib" title={t("Previous page ←")} disabled={!hasBook || (open && turned === 0 && false)} onClick={() => scene?.turn(-1)}>
        <Icon.left />
      </button>
      <div className="prog" title={`${Math.round(progress * 100)}%`}>
        <div className="bar">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
        <span>{open ? `${Math.round(progress * 100)}%` : t('closed')}</span>
      </div>
      <button className="ib" title={t("Next page →")} disabled={!hasBook} onClick={() => scene?.turn(1)}>
        <Icon.right />
      </button>
      <span className="sep" />
      <button className="ib" title={open ? t("Close the book") : t("Open the book")} disabled={!hasBook} onClick={() => scene?.setOpen(!open)}>
        {open ? <Icon.bookClosed /> : <Icon.book />}
      </button>
      <span className="sep" />
      <button className="ib" title={t("Zoom out −")} onClick={() => scene?.zoomBy(1 / 1.1)}>
        <Icon.minus />
      </button>
      <span className="zoom">{Math.round(zoom * 100)}%</span>
      <button className="ib" title={t("Zoom in +")} onClick={() => scene?.zoomBy(1.1)}>
        <Icon.plus />
      </button>
      <FullscreenControl />
      <button className="ib fit-book" title={t("Fit book to screen (0)")} aria-label={t("Fit book to screen (0)")} disabled={!hasBook} onClick={() => scene?.resetView()}>
        <Icon.frameBook />
      </button>
      <TiltControl openMenu={tiltMenu} onOpenChange={setTiltMenu} />
      <AppearanceControl open={menu === 'appearance'} onOpenChange={setAppearanceMenu} />
    </div>
    </div>
  )
}
