import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../i18n'
import { Icon } from './icons'
import { MINDMAP_THEMES, mindmapThemeStyle, type MindmapThemeId } from './mindmapThemes'

export function MindmapThemePicker({ value, onChange }: { value: MindmapThemeId; onChange: (id: MindmapThemeId) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const id = useId(), selected = MINDMAP_THEMES.find(theme => theme.id === value)!
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true) }
  }, [open])
  return <div className="mindmap-theme-picker" ref={root}>
    <button className="btn mindmap-theme-trigger" type="button" ref={trigger} aria-expanded={open} aria-controls={id}
      title={t('思维导图主题')} aria-label={t('思维导图主题：{0}', t(selected.name))} onClick={() => setOpen(!open)}>
      <Icon.palette size={16} /><span>{t(selected.name)}</span><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
    </button>
    {open && <section id={id} className="mindmap-theme-panel" aria-label={t('思维导图主题')}>
      <div className="mindmap-theme-heading"><div><strong>{t('思维导图主题')}</strong><p>{t('只改变外观，不消耗 token')}</p></div><button type="button" className="ib" aria-label={t('关闭主题选择')} onClick={close}><Icon.close size={16} /></button></div>
      <div className="mindmap-theme-options" role="group" aria-label={t('选择主题')}>
        {MINDMAP_THEMES.map(theme => <button type="button" key={theme.id} data-mindmap-theme-option={theme.id}
          className="mindmap-theme-option" aria-pressed={value === theme.id} onClick={() => onChange(theme.id)}>
          <span className="mindmap-theme-preview" data-map-theme={theme.id} style={mindmapThemeStyle(theme)} aria-hidden="true">
            <svg viewBox="0 0 160 72" fill="none">
              <path d="M48 36C72 36 69 15 94 15" stroke={theme.branches[0]} strokeWidth="1.8" /><path d="M48 36C72 36 69 55 94 55" stroke={theme.branches[1]} strokeWidth="1.8" />
              <rect x="10" y="25" width="40" height="22" rx={theme.id === 'ink' ? 3 : 8} fill={theme.root} />
              {[15,55].map((y,i) => <g key={y}><rect x="94" y={y-10} width="55" height="20" rx={theme.id === 'ink' ? 2 : theme.id === 'sand' ? 10 : 6} fill={theme.node} stroke={theme.branches[i]} strokeOpacity=".6" /><path d={`M104 ${y}h30`} stroke={theme.ink} strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" /></g>)}
              <path d="M20 36h20" stroke={theme.rootInk} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="mindmap-theme-name">{t(theme.name)}{value === theme.id && <span aria-hidden="true">✓</span>}</span>
          <small>{t(theme.description)}</small>
        </button>)}
      </div>
      <p className="mindmap-theme-note">{t('自动记住此浏览器的选择')}</p>
    </section>}
  </div>
}
