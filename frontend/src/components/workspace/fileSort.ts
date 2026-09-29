import type { FileEntry } from '../../types'

export type FileSortField = 'name' | 'size' | 'modTime'
export type FileSortDirection = 'asc' | 'desc'

export interface FileSort {
  field: FileSortField
  direction: FileSortDirection
}

export function sortFileEntries(entries: FileEntry[], sort: FileSort): FileEntry[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...entries].sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
    let compared = 0
    if (sort.field === 'size') compared = left.size - right.size
    if (sort.field === 'modTime')
      compared = new Date(left.modTime).getTime() - new Date(right.modTime).getTime()
    if (sort.field === 'name')
      compared = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    return direction * compared || left.name.localeCompare(right.name)
  })
}
