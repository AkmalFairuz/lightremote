import { useEffect, useRef, type ChangeEvent } from 'react'
import { CircularProgress } from '../../ui'
import type { FileEntry } from '../../types'
import { isDriveRoot } from '../../utils/remoteFilePath'
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
  selectedPaths: ReadonlySet<string>
  selectionDisabled: boolean
  onSelect: (entry: FileEntry, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
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
  selectedPaths,
  selectionDisabled,
  onSelect,
  onSelectAll,
  onOpen,
  onDownload,
  onEdit,
  onRename,
  onDelete,
}: FileListProps) {
  const selectAllRef = useRef<HTMLInputElement>(null)
  const eligible = entries.filter((entry) => !isDriveRoot(entry.path))
  const selectedCount = eligible.filter((entry) => selectedPaths.has(entry.path)).length
  const allSelected = eligible.length > 0 && selectedCount === eligible.length
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected
  }, [allSelected, selectedCount])

  function selectAll(event: ChangeEvent<HTMLInputElement>) {
    onSelectAll(event.target.checked)
  }

  return (
    <div
      className={`files-list ${hideActions ? 'files-no-actions' : ''}`}
      role="table"
      aria-label="Remote files"
    >
      <div className="files-header" role="row">
        <span role="columnheader" className="file-selection-cell">
          <input
            ref={selectAllRef}
            type="checkbox"
            aria-label="Select all files and folders"
            checked={allSelected}
            disabled={eligible.length === 0 || loading || selectionDisabled}
            onChange={selectAll}
          />
        </span>
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
        {!hideActions && <span role="columnheader">Actions</span>}
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
            selected={selectedPaths.has(entry.path)}
            selectionDisabled={selectionDisabled}
            onSelect={onSelect}
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
