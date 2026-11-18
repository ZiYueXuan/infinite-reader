import { t, localeUrl } from '../i18n'
import { useId } from 'react'
import { READER_FONTS, readerFontIdOf, quoteFontIdOf } from '../book/fontCatalog'
import { useReader } from '../store/useReader'

export function FontOptions() {
  const id = useId()
  const font = useReader((s) => s.readerFont)
  const quoteFont = useReader((s) => s.quoteFont)
  const loading = useReader((s) => !!s.loading)
  const setFont = useReader((s) => s.setReaderFont)
  const setQuoteFont = useReader((s) => s.setQuoteFont)
  const selected = READER_FONTS.find((f) => f.id === font)!
  return <section className="appearance-section font-options">
    <h2><label htmlFor={id}>{t("阅读字体")}</label></h2>
    <select id={id} value={font} disabled={loading} onChange={(e) => void setFont(readerFontIdOf(e.target.value))}>
      {READER_FONTS.map((f) => <option value={f.id} key={f.id}>{t(f.label)}</option>)}
    </select>
    <p>{t(selected.detail)}</p>
    <h2><label htmlFor={`${id}-quote`}>{t("引用字体")}</label></h2>
    <select id={`${id}-quote`} value={quoteFont} disabled={loading} onChange={(e) => void setQuoteFont(quoteFontIdOf(e.target.value))}>
      <option value="wenkai">{t("霞鹜文楷")}</option>
      <option value="inherit">{t("跟随正文")}</option>
    </select>
    <p>{t("为书中引文选择独立字体，或跟随正文。")}</p>
    <a href={localeUrl('/fonts/licenses.html')} target="_blank" rel="noreferrer">{t("开源字体与许可 ↗")}</a>
  </section>
}
