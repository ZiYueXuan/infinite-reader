import { setLocale, t, useLocale, type Locale } from './index'
import './language.css'
export function LanguageSwitch() {
  const locale = useLocale()
  return <label className="language-switch" data-ui onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></svg></span>
    <select aria-label={t('界面语言')} title={t('界面语言')} value={locale} onChange={e => setLocale(e.target.value as Locale)}>
      <option value="zh-CN">中文</option><option value="en">English</option>
    </select>
  </label>
}
