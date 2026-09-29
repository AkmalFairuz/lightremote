import type { CSSProperties } from 'react'
import { CircularProgress } from '../../ui'
import type { FileEntry } from '../../types'
import { isDriveRoot } from '../../utils/remoteFilePath'
import { isEditableTextFile } from './editableFile'
import { FileRow } from './FileRow'
import type { FileSort, FileSortField } from './fileSort'

interface FileListProps {
  hideActions?: boolean
  entries: FileEntry[]
  loading: boolean
  loadingLabel: string
  showEmpty: boolean
  sort: FileSort
  onSort: (field: FileSortField) => void
  onOpen: (entry: FileEntry) => void
  onDownload: (entry: FileEntry) => void
  onEdit: (entry: FileEntry) => void
  onRename: (entry: FileEntry, name: string) => Promise<void>
  onDelete: (entry: FileEntry) => void
}

export function FileList({
  hideActions = false,
  entries,
  loading,
  loadingLabel,
  showEmpty,
  sort,
  onSort,
  onOpen,
  onDownload,
  onEdit,
  onRename,
  onDelete,
}: FileListProps) {
  let actionSlots = 0
  if (!hideActions) {
    for (const entry of entries) {
      const count = isDriveRoot(entry.path)
        ? 0
        : entry.isDir
          ? 2
          : isEditableTextFile(entry)
            ? 4
            : 3
      actionSlots = Math.max(actionSlots, count)
      if (actionSlots === 4) break
    }
  }
  const showActions = actionSlots > 0

  return (
    <div
      className={`files-list ${showActions ? '' : 'files-no-actions'}`}
      role="table"
      aria-label="Remote files"
      style={{ '--files-actions-width': `${actionSlots * 28 + 4}px` } as CSSProperties}
    >
      <div className="files-header" role="row">
        {(['name', 'size', 'modTime'] as const).map((field) => (
          <span
            key={field}
            role="columnheader"
            aria-sort={
              sort.field === field
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
            }
          >
            <button className="files-sort" onClick={() => onSort(field)}>
              {field === 'modTime' ? 'Modified' : field === 'name' ? 'Name' : 'Size'}
              {sort.field === field && (
                <span aria-hidden="true">{sort.direction === 'asc' ? '↑' : '↓'}</span>
              )}
            </button>
          </span>
        ))}
        {showActions && <span>Actions</span>}
      </div>
      {loading && (
        <div className="files-loading">
          <CircularProgress size={22} />
          <span>{loadingLabel}</span>
        </div>
      )}
      {!loading && showEmpty && entries.length === 0 && (
        <p className="files-empty">This folder is empty.</p>
      )}
      {!loading &&
        entries.map((entry, index) => (
          <FileRow
            key={entry.path}
            entry={entry}
            striped={index % 2 === 1}
            onOpen={onOpen}
            onDownload={onDownload}
            onEdit={onEdit}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
    </div>
  )
}
