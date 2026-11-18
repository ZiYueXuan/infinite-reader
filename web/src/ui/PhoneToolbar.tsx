import { useState } from 'react'
import { t } from '../i18n'
import { useReader } from '../store/useReader'
import { FontOptions } from './FontOptions'
import { Icon } from './icons'
import './phone-reader.css'

export function PhoneToolbar() {
  const { current, scene, turned, leafCount, phoneControls: expanded, loading, showLogin, panel, setPanel, startAsk, returnToShelf } = useReader()
  const [settings, setSettings] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [fontSize, setFontSize] = useState(() => scene?.phoneFontSize ?? 20)
  if (!current || !scene || loading || showLogin) return null
  const close = () => { setSettings(false); useReader.setState({ phoneControls: false }) }
  const seek = (value: string) => { scene.goToLeaf(Number(value)); setProgress(null) }
  return <div className="phone-controls" data-open={expanded} data-ui>
    <button className="phone-folio" aria-label={t('Show reading controls')} onClick={() => useReader.setState({ phoneControls: true })}>
      {Math.min(turned + 1, leafCount)} <span>/ {leafCount}</span>
    </button>
    <div className="phone-top" inert={!expanded} aria-hidden={!expanded}>
      <button className="ib" aria-label={t('Back')} onClick={returnToShelf}><Icon.left /></button>
      <div><strong>{current.meta.title}</strong><span>{current.meta.author}</span></div>
      <button className="ib" aria-label={t('Hide reading controls')} onClick={close}><Icon.close /></button>
    </div>
    <div className="phone-bottom" inert={!expanded} aria-hidden={!expanded} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
    }}>
      {settings && <section className="phone-settings" role="dialog" aria-label={t('Reading appearance')}>
        <header><strong>{t('Reading appearance')}</strong><button className="ib" aria-label={t('Close')} onClick={() => setSettings(false)}><Icon.close size={18} /></button></header>
        <div className="phone-type-size"><span>{t('Text size')}</span><button disabled={fontSize <= 16} aria-label={t('Smaller text')} onClick={() => { setFontSize(fontSize - 1); scene.setPhoneFontSize(fontSize - 1) }}>A−</button>
          <output>{fontSize}</output><button disabled={fontSize >= 28} aria-label={t('Larger text')} onClick={() => { setFontSize(fontSize + 1); scene.setPhoneFontSize(fontSize + 1) }}>A+</button></div>
        <FontOptions />
      </section>}
      <div className="phone-progress">
        <button className="ib" aria-label={t('Previous page ←')} disabled={turned === 0} onClick={() => scene.turn(-1)}><Icon.left size={18} /></button>
        <input type="range" min={0} max={Math.max(0, leafCount - 1)} value={progress ?? turned} aria-label={t('Reading progress')}
          onChange={e => setProgress(Number(e.target.value))} onPointerUp={e => seek(e.currentTarget.value)}
          onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) seek(e.currentTarget.value) }}
          onPointerCancel={() => setProgress(null)} />
        <button className="ib" aria-label={t('Next page →')} disabled={turned >= leafCount - 1} onClick={() => scene.turn(1)}><Icon.right size={18} /></button>
      </div>
      <nav aria-label={t('Reading controls')}>
        <button onClick={() => { setSettings(false); setPanel(panel === 'toc' ? 'none' : 'toc') }}><Icon.list /><span>{t('Contents & marks')}</span></button>
        <button onClick={() => { close(); startAsk() }}><Icon.sparkle /><span>{t('Ask AI')}</span></button>
        <button aria-expanded={settings} onClick={() => setSettings(!settings)}><span className="phone-type-icon">Aa</span><span>{t('Reading appearance')}</span></button>
      </nav>
    </div>
  </div>
}
