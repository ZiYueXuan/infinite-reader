import { LOCALE_KEY, normalizeLocale, translate, type Locale } from '../../../shared/i18n.ts'
export type { Locale }
function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const explicit = new URLSearchParams(location.search).get('lang')
  if (explicit === 'zh-CN' || explicit === 'en') return explicit
  const cookie = document.cookie.match(/(?:^|;\s*)ir_locale=(zh-CN|en)(?:;|$)/)?.[1]
  if (cookie) return normalizeLocale(cookie)
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved === 'zh-CN' || saved === 'en') return saved
  } catch { /* Preferences still work for this session. */ }
  return normalizeLocale(navigator.language)
}
let locale = initialLocale()
const listeners = new Set<() => void>()
export const getLocale = () => locale
export const t = (key: string, ...args: unknown[]) => translate(key, locale, ...args)
function reflectLocale() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.cookie = `ir_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
}
reflectLocale()
export function setLocale(next: Locale) {
  try { localStorage.setItem(LOCALE_KEY, next) } catch { /* Optional storage. */ }
  if (locale === next) return
  locale = next
  if (typeof window !== 'undefined') {
    const url = new URL(location.href)
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', next)
      history.replaceState(history.state, '', url)
    }
  }
  reflectLocale()
  listeners.forEach(fn => fn())
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('reader:locale'))
}
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === LOCALE_KEY && (event.newValue === 'en' || event.newValue === 'zh-CN')) setLocale(event.newValue)
})
export const localeUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}lang=${locale}`
/** Unknown server errors get a useful localized fallback, never raw internal details. */
export function errorText(message: string, fallback = 'Something went wrong.'): string {
  const translated = t(message)
  return translated !== message || t(message) !== translate(message, locale === 'en' ? 'zh-CN' : 'en') ? translated : t(fallback)
}
