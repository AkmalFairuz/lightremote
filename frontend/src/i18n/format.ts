import { currentLanguage } from './index'

const numbers = new Map<string, Intl.NumberFormat>()
const dates = new Map<string, Intl.DateTimeFormat>()
const collators = new Map<string, Intl.Collator>()
export function formatNumber(
  value: number,
  maximumFractionDigits = 0,
  language = currentLanguage(),
): string {
  const key = `${language}:${maximumFractionDigits}`
  let formatter = numbers.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, { maximumFractionDigits })
    numbers.set(key, formatter)
  }
  return formatter.format(value)
}
export function formatDate(value: Date, language = currentLanguage()): string {
  let formatter = dates.get(language)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium' })
    dates.set(language, formatter)
  }
  return formatter.format(value)
}
export function nameCollator(
  sensitivity: 'base' | 'variant' = 'base',
  language = currentLanguage(),
): Intl.Collator {
  const key = `${language}:${sensitivity}`
  let collator = collators.get(key)
  if (!collator) {
    collator = new Intl.Collator(language, { sensitivity })
    collators.set(key, collator)
  }
  return collator
}
