import { t } from '../i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { FontOptions } from './FontOptions'
import { useEffect, useId, useRef, useState } from 'react'
import { DESK_SURFACES } from '../settings'
import { canImportBook, useReader } from '../store/useReader'
import { AccountChip } from './Login'
import { SurfaceOptions } from './SurfaceOptions'
import { Icon } from './icons'

/** One compact home for shelf actions; only one dropdown opens at a time. */
export function ShelfControls({ onOpenCosts }: { onOpenCosts?: () => void }) {
  const { desk, setDesk, session, openBlob, setShowLogin } = useReader()
  const guest = session.status === 'local' || session.status === 'checking'
  const [open, setOpen] = useState<'account' | 'theme' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const themeToggle = useRef<HTMLButtonElement>(null)
  const themePanel = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const themeId = useId()
  const surface = DESK_SURFACES.find((s) => s.id === desk) ?? DESK_SURFACES[0]

  useEffect(() => {
    if (open !== 'theme') return
    themePanel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(null)
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [open])

  const closeTheme = () => {
    setOpen(null)
    themeToggle.current?.focus()
  }

  return (
    <div
      className={`shelf-controls${guest ? ' shelf-controls-guest' : ''}`}
      role="group"
      aria-label={t("Shelf actions")}
      ref={root}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(null)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && open === 'theme') {
          e.preventDefault()
          closeTheme()
        }
      }}
    >
      <div className="shelf-language-control" onFocus={() => setOpen(null)}><LanguageSwitch /></div>
      <button
        type="button"
        className="shelf-control shelf-theme-toggle"
        ref={themeToggle}
        aria-label={`${t("Appearance")} · ${t(surface.label)}`}
        aria-expanded={open === 'theme'}
        aria-haspopup="dialog"
        aria-controls={open === 'theme' ? themeId : undefined}
        title={t("Appearance")}
        onClick={() => setOpen(open === 'theme' ? null : 'theme')}
      >
        <Icon.palette size={17} />
        <span className="shelf-theme-name">{t("Appearance")}</span>
        <span className="shelf-chevron" aria-hidden="true"><Icon.up size={12} /></span>
      </button>
      {open === 'theme' && (
        <div className="shelf-theme-pop" id={themeId} ref={themePanel} role="dialog" aria-label={t("Appearance")}>
          <SurfaceOptions label={t("Desk theme")} value={desk} items={DESK_SURFACES} onChange={setDesk} />
          <FontOptions />
        </div>
      )}
      {!guest && <button
        type="button"
        className="shelf-control shelf-upload"
        aria-label={t("Add EPUB")}
        title={t("Add EPUB")}
        onClick={() => {
          setOpen(null)
          if (!canImportBook()) {
            void setShowLogin(true)
            return
          }
          fileInput.current?.click()
        }}
      >
        <Icon.plus size={17} />
        <span>{t("Add EPUB")}</span>
      </button>}
      {session.status !== 'checking' && <span className="shelf-control-divider" aria-hidden="true" />}
      <AccountChip embedded onOpenCosts={onOpenCosts} open={open === 'account'} onOpenChange={(value) => setOpen(value ? 'account' : null)} />
      <input
        ref={fileInput}
        type="file"
        accept=".epub,application/epub+zip"
        hidden
        disabled={session.status !== 'user' || !canImportBook()}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void openBlob(file, file.name)
        }}
      />
    </div>
  )
}
