import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import { CircularProgress } from '../../ui'
import type { FileEntry } from '../../types'
import { isDriveRoot } from '../../utils/remoteFilePath'
import { FileRow } from './FileRow'
import type { FileSort, FileSortField } from './fileSort'

interface FileListProps {
  directoryKey: string
  hideActions?: boolean
  entries: FileEntry[]
  loading: boolean
  loadingLabel: string
  showEmpty: boolean
  sort: FileSort
  onSort: (field: FileSortField) => void
  selectedPaths: ReadonlySet<string>
  selecting: boolean
  selectionDisabled: boolean
  onSelect: (entry: FileEntry, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onOpen: (entry: FileEntry) => void
  onDownload: (entry: FileEntry) => void
  onEdit: (entry: FileEntry) => void
  onCopyPath: (entry: FileEntry) => void
  onRename: (entry: FileEntry, name: string) => Promise<void>
  onDelete: (entry: FileEntry) => void
}

const rowHeight = 29
const headerHeight = 27
const overscan = 8
const minimumWidths = { name: 100, size: 56, modTime: 90 }
const defaultWidths = { name: null, size: 70, modTime: 135 }
const columnLabels = { name: 'Name', size: 'Size', modTime: 'Modified' }

export function FileList({
  directoryKey,
  hideActions = false,
  entries,
  loading,
  loadingLabel,
  showEmpty,
  sort,
  onSort,
  selectedPaths,
  selecting,
  selectionDisabled,
  onSelect,
  onSelectAll,
  onOpen,
  onDownload,
  onEdit,
  onCopyPath,
  onRename,
  onDelete,
}: FileListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [widths, setWidths] = useState<Record<FileSortField, number | null>>(defaultWidths)
  const resize = useRef<{ field: FileSortField; x: number; width: number } | null>(null)
  const [viewport, setViewport] = useState({ directoryKey, top: 0, height: 400 })
  const [activePaths, setActivePaths] = useState<ReadonlySet<string>>(() => new Set())
  const eligibleCount = useMemo(
    () => entries.reduce((count, entry) => count + Number(!isDriveRoot(entry.path)), 0),
    [entries],
  )
  const selectedCount = useMemo(
    () =>
      selecting
        ? entries.reduce(
            (count, entry) =>
              count + Number(selectedPaths.has(entry.path) && !isDriveRoot(entry.path)),
            0,
          )
        : 0,
    [entries, selectedPaths, selecting],
  )
  const allSelected = eligibleCount > 0 && selectedCount === eligibleCount

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected
  }, [allSelected, selectedCount, selecting])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = list.scrollTop
        const height = list.clientHeight
        setViewport((current) =>
          current.directoryKey === directoryKey && current.top === top && current.height === height
            ? current
            : { directoryKey, top, height },
        )
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    list.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      list.removeEventListener('scroll', measure)
    }
  }, [directoryKey])

  const keepRowMounted = useCallback((path: string, active: boolean) => {
    setActivePaths((current) => {
      if (current.has(path) === active) return current
      const next = new Set(current)
      if (active) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])
  // Keep focused rows, menus, and rename forms mounted when they scroll out of view.
  const activeIndices = useMemo(
    () =>
      [...activePaths]
        .map((path) => entries.findIndex((entry) => entry.path === path))
        .filter((index) => index >= 0),
    [activePaths, entries],
  )
  const scrollTop = Math.min(
    viewport.directoryKey === directoryKey ? viewport.top : 0,
    Math.max(0, headerHeight + entries.length * rowHeight - viewport.height),
  )
  const first = Math.min(
    Math.max(0, entries.length - 1),
    Math.max(0, Math.floor((scrollTop - headerHeight) / rowHeight) - overscan),
  )
  const last = Math.min(
    entries.length,
    Math.max(
      first + 1,
      Math.ceil((scrollTop + viewport.height - headerHeight) / rowHeight) + overscan,
    ),
  )
  const rowIndices = [
    ...new Set([
      ...Array.from({ length: last - first }, (_, offset) => first + offset),
      ...activeIndices,
    ]),
  ].sort((left, right) => left - right)
  const columnCount = 3 + Number(selecting) + Number(!hideActions)
  const style = {
    '--files-columns': `${selecting ? '24px ' : ''}${widths.name === null ? 'minmax(140px, 1fr)' : `${widths.name}px`} ${widths.size}px ${widths.modTime}px${hideActions ? '' : ' 28px'}`,
    '--files-min-width': `${(widths.name ?? 140) + (widths.size ?? 70) + (widths.modTime ?? 135) + (selecting ? 24 : 0) + (hideActions ? 0 : 28) + (columnCount - 1) * 8 + 24}px`,
    '--files-row-height': `${rowHeight}px`,
    '--files-header-height': `${headerHeight}px`,
  } as CSSProperties

  function startResize(event: PointerEvent<HTMLSpanElement>, field: FileSortField) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resize.current = {
      field,
      x: event.clientX,
      width: event.currentTarget.parentElement!.getBoundingClientRect().width,
    }
  }

  return (
    <div
      key={directoryKey}
      ref={listRef}
      className={`files-list ${hideActions ? 'files-no-actions' : ''} ${selecting ? 'files-selecting' : ''}`}
      style={style}
      role="table"
      aria-label="Remote files"
      aria-rowcount={entries.length + 1}
      aria-colcount={columnCount}
      aria-busy={loading}
    >
      <div className="files-header" role="row" aria-rowindex={1}>
        {selecting && (
          <span role="columnheader" className="file-selection-cell">
            <input
              ref={selectAllRef}
              type="checkbox"
              aria-label="Select all files and folders"
              checked={allSelected}
              disabled={eligibleCount === 0 || loading || selectionDisabled}
              onChange={(event) => onSelectAll(event.target.checked)}
            />
          </span>
        )}
        {(['name', 'size', 'modTime'] as const).map((field) => (
          <span
            key={field}
            role="columnheader"
            className="files-column-header"
            aria-sort={
              sort.field === field
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
            }
          >
            <button className="files-sort" onClick={() => onSort(field)}>
              {columnLabels[field]}
              {sort.field === field && (
                <span aria-hidden="true">{sort.direction === 'asc' ? '↑' : '↓'}</span>
              )}
            </button>
            <span
              className="files-column-resize"
              role="separator"
              tabIndex={0}
              aria-label={`Resize ${columnLabels[field]} column`}
              aria-orientation="vertical"
              aria-valuemin={minimumWidths[field]}
              aria-valuenow={widths[field] ?? 140}
              title="Drag to resize; use arrow keys to adjust; double-click to reset"
              onPointerDown={(event) => startResize(event, field)}
              onPointerMove={(event) => {
                const drag = resize.current
                if (!drag || drag.field !== field) return
                const width = Math.max(minimumWidths[field], drag.width + event.clientX - drag.x)
                setWidths((current) => ({ ...current, [field]: Math.round(width) }))
              }}
              onLostPointerCapture={() => {
                resize.current = null
              }}
              onDoubleClick={() =>
                setWidths((current) => ({ ...current, [field]: defaultWidths[field] }))
              }
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                const width = event.currentTarget.parentElement!.getBoundingClientRect().width
                const delta = event.key === 'ArrowLeft' ? -16 : 16
                setWidths((current) => ({
                  ...current,
                  [field]: Math.max(minimumWidths[field], Math.round(width + delta)),
                }))
              }}
            />
          </span>
        ))}
        {!hideActions && <span role="columnheader" aria-label="Actions" />}
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
      {!loading && (
        <div className="files-rows" role="rowgroup" style={{ height: entries.length * rowHeight }}>
          {rowIndices.map((index) => {
            const entry = entries[index]
            return (
              <FileRow
                key={entry.path}
                entry={entry}
                index={index}
                striped={index % 2 === 1}
                selecting={selecting}
                selected={selectedPaths.has(entry.path)}
                selectionDisabled={selectionDisabled}
                onSelect={onSelect}
                onOpen={onOpen}
                onDownload={onDownload}
                onEdit={onEdit}
                onCopyPath={onCopyPath}
                onRename={onRename}
                onDelete={onDelete}
                onActiveChange={keepRowMounted}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
