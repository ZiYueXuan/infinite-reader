import messages from './messages.json' with { type: 'json' }

export type Locale = 'zh-CN' | 'en'
export const LOCALE_KEY = 'ir:locale'
export const LOCALE_COOKIE = 'ir_locale'
export function normalizeLocale(value: string | null | undefined): Locale {
  return /^zh(?:-|$)/i.test(value ?? '') ? 'zh-CN' : 'en'
}
const entries = messages as unknown as Record<string, [string, string]>
const reverse = new Map<string, [string, string]>()
for (const pair of Object.values(entries)) for (const value of pair) if (!reverse.has(value)) reverse.set(value, pair)
const templates: { pattern: RegExp; indexes: number[]; pair: [string, string] }[] = []
for (const [key, pair] of Object.entries(entries)) {
  for (const value of new Set([key, ...pair])) {
    if (!/\{\d+\}/.test(value)) continue
    const indexes: number[] = []
    const pattern = value.split(/(\{\d+\})/).map(part => {
      if (/^\{\d+\}$/.test(part)) { indexes.push(Number(part.slice(1, -1))); return '([\\s\\S]*?)' }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }).join('')
    templates.push({ pattern: new RegExp('^' + pattern + '$'), indexes, pair })
  }
}
function format(value: string, args: readonly unknown[]) {
  return value.replace(/\{(\d+)\}/g, (match, n: string) => Number(n) < args.length ? String(args[Number(n)] ?? '') : match)
}
/** Translate interface copy only. Never pass book, note, or AI answer content here. */
export function translate(key: string, locale: Locale, ...args: unknown[]): string {
  const pair = (Object.hasOwn(entries, key) ? entries[key] : undefined) ?? reverse.get(key)
  if (pair) return format(pair[locale === 'zh-CN' ? 0 : 1], args)
  // Persisted status messages and server costs may already contain interpolated values.
  for (const template of templates) {
    const match = template.pattern.exec(key)
    if (!match) continue
    const values: string[] = []
    template.indexes.forEach((index, i) => { values[index] = match[i + 1] })
    return format(template.pair[locale === 'zh-CN' ? 0 : 1], values)
  }
  if (key.includes('；')) return key.split('；').map(part => translate(part.trim(), locale)).join(locale === 'zh-CN' ? '；' : '; ')
  return key
}

export function requestLocale(request: Request): Locale {
  const url = new URL(request.url)
  const explicit = url.searchParams.get('lang')
  if (explicit === 'zh-CN' || explicit === 'en') return explicit
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)ir_locale=(zh-CN|en)(?:;|$)/)?.[1]
  if (cookie) return normalizeLocale(cookie)
  return normalizeLocale(request.headers.get('accept-language')?.split(',')[0])
}
