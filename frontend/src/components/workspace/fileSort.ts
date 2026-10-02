import { currentLanguage } from '../../i18n'
import { nameCollator } from '../../i18n/format'
import type { FileEntry } from '../../types'

export type FileSortField = 'name' | 'size' | 'modTime'
export type FileSortDirection = 'asc' | 'desc'

export interface FileSort {
  field: FileSortField
  direction: FileSortDirection
}

// Reuse collators instead of constructing one for every name comparison.

export function sortFileEntries(
  entries: FileEntry[],
  sort: FileSort,
  language = currentLanguage(),
): FileEntry[] {
  const collator = nameCollator('base', language)
  const tieCollator = nameCollator('variant', language)
  const direction = sort.direction === 'asc' ? 1 : -1
  const modifiedTimes =
    sort.field === 'modTime'
      ? new Map(entries.map((entry) => [entry, Date.parse(entry.modTime) || 0]))
      : null
  return [...entries].sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
    let compared = 0
    if (sort.field === 'size') compared = left.size - right.size
    if (sort.field === 'modTime') compared = modifiedTimes!.get(left)! - modifiedTimes!.get(right)!
    if (sort.field === 'name') compared = collator.compare(left.name, right.name)
    return direction * compared || tieCollator.compare(left.name, right.name)
  })
}
