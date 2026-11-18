import { t } from '../i18n'

export function SurfaceOptions<T extends string>({ label, value, items, onChange, onSelect }: {
  label: string
  value: T
  items: readonly { id: T; label: string; swatch: string; material?: string }[]
  onChange: (id: T) => void
  onSelect?: () => void
}) {
  return (
    <section className="appearance-section">
      <h2>{label}</h2>
      <div
        className="appearance-options"
        role="radiogroup"
        aria-label={label}
        onKeyDown={(e) => {
          const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
          const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          if (!forward && !backward && e.key !== 'Home' && e.key !== 'End') return
          e.preventDefault()
          e.stopPropagation()
          const current = items.findIndex((item) => item.id === value)
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
            : (current + (forward ? 1 : -1) + items.length) % items.length
          onChange(items[next].id)
          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
        }}
      >
        {items.map((item) => {
          const on = value === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(item.label)}
              tabIndex={on ? 0 : -1}
              title={t(item.label)}
              className={on ? 'on' : ''}
              onClick={() => { onChange(item.id); onSelect?.() }}
            >
              <i className="surface-swatch" data-material={item.material ?? 'paper'} style={{ backgroundColor: item.swatch }} aria-hidden="true" />
              <span>{t(item.label)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

