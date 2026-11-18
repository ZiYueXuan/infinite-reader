import { useCallback, useSyncExternalStore } from 'react'
import { translate } from '../../../shared/i18n'
import { subscribe, getLocale } from './runtime'
export * from './runtime'
export const useLocale = () => useSyncExternalStore(subscribe, getLocale, getLocale)

export function useT() {
  const locale = useLocale()
  return useCallback((key: string, ...args: unknown[]) => translate(key, locale, ...args), [locale])
}
