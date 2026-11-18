import { useEffect, useId, useRef } from 'react'
import { t } from '../i18n'
import { DESK_SURFACES, ENDPAPER_SURFACES } from '../settings'
import { useReader } from '../store/useReader'
import { FontOptions } from './FontOptions'
import { SurfaceOptions } from './SurfaceOptions'
import { Icon } from './icons'

export function AppearanceControl({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { desk, setDesk, endpaper, setEndpaper } = useReader()
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onOpenChange(false)
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [open, onOpenChange])

  return <div className="appearance-menu" ref={root}>
    <button ref={toggle} type="button" className={'ib' + (open ? ' on' : '')}
      aria-label={t('Reading appearance')} title={t('Reading appearance')}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      onClick={() => onOpenChange(!open)}><Icon.palette /></button>
    {open && <div id={id} className="appearance-pop" role="dialog" aria-label={t('Reading appearance')}
      onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <div className="appearance-heading">
        <span>{t('Reading appearance')}</span>
        <button type="button" className="ib sm" aria-label={t('Close')} title={t('Close')}
          onClick={() => { onOpenChange(false); toggle.current?.focus({ preventScroll: true }) }}><Icon.close size={15} /></button>
      </div>
      <SurfaceOptions label={t('Desk')} value={desk} items={DESK_SURFACES} onChange={setDesk} />
      <SurfaceOptions label={t('Endpaper')} value={endpaper} items={ENDPAPER_SURFACES} onChange={setEndpaper} />
      <FontOptions />
    </div>}
  </div>
}
