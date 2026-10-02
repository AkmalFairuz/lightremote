import { currentLanguage } from '../i18n'
import { formatNumber } from '../i18n/format'
const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(bytes: number, language = currentLanguage()): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0
    ? `${formatNumber(Math.round(value), 0, language)} B`
    : `${formatNumber(value, 1, language)} ${units[unit]}`
}
