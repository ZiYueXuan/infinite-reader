import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { t, localeUrl, errorText } from '../i18n'
import { TERMS_VERSION, TERMS_URL } from '../../../shared/terms'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { authApi } from '../api/auth'
import { ApiError } from '../api/http'
import { useReader } from '../store/useReader'
import { Icon } from './icons'

const AUTH_ERRORS: Record<string, string> = {
  terms_required: 'Please sign in again and accept the Terms of Use to continue using your account.',
  terms_updated: 'The Terms of Use have changed. Please read and accept the current version.',
  google_denied: 'Google sign-in was cancelled.',
  invalid_oauth_state: 'Sign-in expired, please try again.',
  google_token_failed: 'Google sign-in failed, please try again.',
  google_userinfo_failed: 'Could not retrieve your Google profile. Please try signing in again.',
  google_storage_unavailable: 'Account storage is temporarily unavailable. Please wait a moment, then start Google sign-in again.',
  google_signin_failed: 'Could not finish signing in. Please start Google sign-in again.',
  google_email_unverified: 'That Google account has no verified email.',
  email_not_allowed: 'That email is not allowed on this deployment.',
}

export function LoginCard() {
  const open = useReader(s => s.session.status === 'anon' || s.showLogin)
  return open ? <LoginForm /> : null
}

function LoginForm() {
  const { session, providers, authError, loggedIn, goOffline, setShowLogin } = useReader()
  const [accepted, setAccepted] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cool, setCool] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cool <= 0) return
    const t = setTimeout(() => setCool(cool - 1), 1000)
    return () => clearTimeout(t)
  }, [cool])

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { setAccepted(false); setBusy(false) }
    }
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [])

  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      setErr(e.code === 'invalid_code' ? t("That code is wrong or expired.") : e.code === 'cooldown' && e.retryAfter ? t("Please wait {0}s before requesting another code.", e.retryAfter) : e.message)
      if (e.retryAfter) setCool(e.retryAfter)
    } else setErr(e instanceof Error ? e.message : t("Something went wrong"))
  }

  const send = async () => {
    if (!accepted) return
    setBusy(true)
    setErr(null)
    try {
      await authApi.requestCode(email.trim())
      setStep('code')
      setCool(30)
      setTimeout(() => codeRef.current?.focus(), 60)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!accepted) return
    setBusy(true)
    setErr(null)
    try {
      const user = await authApi.verify(email.trim(), code.trim(), { accepted: true, version: TERMS_VERSION })
      setCode('')
      setStep('email')
      await loggedIn(user)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const startGoogle = async () => {
    if (!accepted) return
    setBusy(true)
    setErr(null)
    try {
      const { url } = await authApi.googleStart(location.pathname, { accepted: true, version: TERMS_VERSION })
      location.assign(url)
    } catch (e) { fail(e); setBusy(false) }
  }

  const cancel = () => (session.status === 'anon' ? goOffline() : setShowLogin(false))

  return (
    <div className="welcome login" data-ui>
      <div className="card">
        <div className="login-language"><LanguageSwitch /></div>
        <div className="mark">
          <Icon.book size={30} />
        </div>
        <h1>{t("Sign in")}</h1>
        <p>{t("Your library, marks and inline notes follow you across devices. Or keep reading offline - everything stays in this browser.")}</p>
        {authError && <div className="error">{t(AUTH_ERRORS[authError] ?? 'Sign-in failed.')}</div>}

        <div className="terms-consent">
          <label>
            <input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />
            <span>{t("I have read and accept the")} <a href={localeUrl(TERMS_URL)} target="_blank" rel="noopener noreferrer">{t("Terms of Use")}</a>{t(", including the copyright and upload responsibilities.")}</span>
          </label>
          <p>{t("Only upload books you own the rights to or are authorised to upload and process. Buying or subscribing to a book does not automatically grant these rights.")}</p>
          <a href={localeUrl('/privacy')} target="_blank" rel="noopener noreferrer">{t("Privacy Policy")}</a>
        </div>
        {providers.google && (
          <button type="button" className="btn google" disabled={busy || !accepted} onClick={() => void startGoogle()}>
            {t("Continue with Google")}</button>
        )}

        {providers.email ? (
          step === 'email' ? (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <input type="email" aria-label={t('Email address')} required autoFocus placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn primary" disabled={busy || !accepted || !email.includes('@')}>
                {busy ? t("Sending…") : t("Email me a code")}
              </button>
            </form>
          ) : (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault()
                void verify()
              }}
            >
              <div className="hint">
                {t("We sent a 6-digit code to")} <b>{email}</b>.
              </div>
              <input
                ref={codeRef}
                aria-label={t('Verification code')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="code"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <button className="btn primary" disabled={busy || !accepted || code.length !== 6}>
                {busy ? t("Checking…") : t("Sign in")}
              </button>
              <button type="button" className="link" disabled={cool > 0 || busy || !accepted} onClick={() => void send()}>
                {cool > 0 ? t("Resend in {0}s", cool) : t("Resend code")}
              </button>
              <button type="button" className="link" onClick={() => setStep('email')}>
                {t("Use a different email")}</button>
            </form>
          )
        ) : (
          !providers.google && <div className="hint">{t("Sign-in is not available on this deployment.")}</div>
        )}

        {err && <div className="error">{errorText(err)}</div>}
        <button className="link muted" onClick={cancel}>
          {session.status === 'anon' ? t("Continue offline") : t("Cancel")}
        </button>
      </div>
    </div>
  )
}

export function AccountChip({ embedded = false, open, onOpenChange, onOpenCosts }: {
  embedded?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onOpenCosts?: () => void
}) {
  const { session, logout, setShowLogin } = useReader()
  const [localOpen, setLocalOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const menuOpen = open ?? localOpen
  const changeMenu = useCallback((next: boolean) => {
    if (open === undefined) setLocalOpen(next)
    onOpenChange?.(next)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!menuOpen || session.status !== 'user') return
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) changeMenu(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      changeMenu(false)
      trigger.current?.focus()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [menuOpen, session.status, changeMenu])

  if (session.status === 'checking' || session.status === 'anon') return null
  const accountClass = `${embedded ? 'account embedded' : 'account'}${session.status === 'local' ? ' guest' : ''}`
  if (session.status === 'local') {
    return (
      <div className={accountClass} data-ui onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        {!embedded && <><LanguageSwitch /><span className="guest-account-divider" aria-hidden="true" /></>}
        <button type="button" className="chip" aria-label={t("Sign in")} aria-haspopup="dialog" onClick={() => void setShowLogin(true)} title={t("Sign in to sync across devices")}>
          <span className="nm">{t("Sign in")}</span>
          <Icon.right size={14} />
        </button>
      </div>
    )
  }
  const u = session.user
  const label = u.name || u.email
  return (
    <div
      ref={root}
      className={accountClass}
      data-ui
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (menuOpen && (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget))) changeMenu(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="chip"
        aria-label={t("Account: {0}", label)}
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => changeMenu(!menuOpen)}
        title={u.email}
      >
        {u.avatar_url ? <img src={u.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>}
        <span className="nm">{label}</span>
      </button>
      {menuOpen && (
        <div className="menu" id={menuId}>
          <div className="em">{u.email}</div>
          {!embedded && <div className="account-language"><LanguageSwitch /></div>}
          {u.can_view_cost_debug && onOpenCosts && <button type="button" onClick={() => { changeMenu(false); onOpenCosts() }}>{t("费用 · DEBUG")}</button>}
          <button
            type="button"
            onClick={() => {
              changeMenu(false)
              void logout()
            }}
          >
            {t("Sign out")}</button>
        </div>
      )}
    </div>
  )
}
