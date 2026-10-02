import { useSyncExternalStore } from 'react'
import { i18n, currentLanguage } from './index'

function subscribe(listener: () => void) {
  i18n.on('languageChanged', listener)
  return () => {
    i18n.off('languageChanged', listener)
  }
}

/** An explicit snapshot makes locale dependencies visible to React's compiler. */
export function useLocale() {
  return useSyncExternalStore(subscribe, currentLanguage, () => 'en' as const)
}
