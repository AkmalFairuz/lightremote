import { useTranslation } from 'react-i18next'
import type { t } from './index'

/** The bound translator changes identity with the language, including in compiled React. */
export function useT(): typeof t {
  return useTranslation().t as typeof t
}
