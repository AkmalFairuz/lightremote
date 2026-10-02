import { useMemo, useRef, useState, type DragEvent } from 'react'
import { files } from '../../api/files'
import { Alert, DialogPresence, IconButton, Snackbar, Tooltip } from '../../ui'
import { errorMessage, type ConnectionKind, type FileEntry } from '../../types'
import { ConfirmDialog, TextPromptDialog } from '../common/ActionDialogs'
import { Glyph } from '../common/Glyph'
import { FileList, type FileScrollPosition } from './FileList'
import { FileEditor } from './FileEditor'
import { FileToolbar } from './FileToolbar'
import { FileSearch } from './FileSearch'
import { FileTransfer, type Transfer } from './FileTransfer'
import { recordTransferProgress } from './transferProgress'
import { sortFileEntries, type FileSort, type FileSortField } from './fileSort'
import {
  isDriveRoot,
  joinRemotePath,
  normalizeRemotePath,
  parentRemotePath,
} from '../../utils/remoteFilePath'
import { useRemoteDirectory } from './useRemoteDirectory'
import { saveRemoteFile } from '../../desktop/actions'
import { isDesktop } from '../../desktop/viewerSocket'
import { desktopRuntime } from '../../desktop/runtime'

interface Notice {
  id: string
  message: string
}

interface DirectorySearch {
  scope: string
  query: string
  regex: boolean
  scrollPositions: Map<string, FileScrollPosition>
}

const transferNamespace = Math.random().toString(36).slice(2)
const emptyEntries: FileEntry[] = []
let transferSequence = 0

function nextTransferId() {
  transferSequence += 1
  return `${transferNamespace}-${transferSequence}`
}

export function FileManager({
  connectionId,
  kind,
  active,
  initialPath,
  onPathChange,
}: {
  connectionId: string
  kind: ConnectionKind
  active: boolean
  initialPath?: string
  onPathChange?: (path: string) => void
}) {
  const { path, entries, loadedPath, loading, error, setError, changePath, load } =
    useRemoteDirectory({ connectionId, kind, active, initialPath, onPathChange })
  const currentPath = path ?? '/'
  const [scrollPositions] = useState(() => new Map<string, FileScrollPosition>())
  const [sort, setSort] = useState<FileSort>({ field: 'name', direction: 'asc' })
  const sortedEntries = useMemo(() => sortFileEntries(entries, sort), [entries, sort])
  const selectionScope = `${connectionId}\0${path ?? ''}`
  const [search, setSearch] = useState<DirectorySearch>(() => ({
    scope: selectionScope,
    query: '',
    regex: false,
    scrollPositions: new Map(),
  }))
  if (search.scope !== selectionScope) {
    setSearch({ ...search, scope: selectionScope, query: '', scrollPositions: new Map() })
  }
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<{ scope: string; paths: Set<string> }>(() => ({
    scope: selectionScope,
    paths: new Set(),
  }))
  if (selection.scope !== selectionScope) {
    setSelecting(false)
    setSelection({ scope: selectionScope, paths: new Set() })
  }
  const directoryEntries = loadedPath === path ? sortedEntries : emptyEntries
  // Normalize filenames once per listing, rather than allocating strings on every keystroke.
  const searchNames = useMemo(
    () => directoryEntries.map((entry) => entry.name.toLowerCase()),
    [directoryEntries],
  )
  const searchPattern = useMemo(() => {
    if (!search.query || !search.regex) return { pattern: null, error: null }
    try {
      return { pattern: new RegExp(search.query, 'i'), error: null }
    } catch {
      return { pattern: null, error: 'Invalid regular expression.' }
    }
  }, [search.query, search.regex])
  const visibleEntries = useMemo(() => {
    if (!search.query) return directoryEntries
    if (searchPattern.error) return emptyEntries
    const matches: FileEntry[] = []
    if (searchPattern.pattern) {
      for (const entry of directoryEntries) {
        if (searchPattern.pattern.test(entry.name)) matches.push(entry)
      }
    } else {
      const query = search.query.toLowerCase()
      for (let index = 0; index < searchNames.length; index += 1) {
        if (searchNames[index].includes(query)) matches.push(directoryEntries[index])
      }
    }
    return matches
  }, [directoryEntries, search.query, searchNames, searchPattern])
  // Filtered views get temporary positions so they never overwrite the full directory's scroll.
  const listKey = search.query
    ? JSON.stringify([selectionScope, search.query, search.regex])
    : selectionScope
  const selectedPaths = useMemo(() => {
    const paths = new Set<string>()
    if (selection.scope === selectionScope && selection.paths.size > 0) {
      for (const entry of visibleEntries) {
        if (selection.paths.has(entry.path)) paths.add(entry.path)
      }
    }
    return paths
  }, [selection, selectionScope, visibleEntries])
  const selectedEntries = useMemo(
    () =>
      selectedPaths.size
        ? visibleEntries.filter((entry) => selectedPaths.has(entry.path))
        : emptyEntries,
    [visibleEntries, selectedPaths],
  )
  const downloadableEntries = useMemo(
    () => selectedEntries.filter((entry) => !entry.isDir),
    [selectedEntries],
  )
  const [busy, setBusy] = useState(false)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [dropActive, setDropActive] = useState(false)
  const [editingFile, setEditingFile] = useState<FileEntry | null>(null)
  const [pending, setPending] = useState<
    | { type: 'delete'; entry: FileEntry }
    | { type: 'bulkDelete'; entries: FileEntry[] }
    | { type: 'mkdir' }
    | null
  >(null)
  const dragDepth = useRef(0)

  function updateSearch(query: string, regex: boolean) {
    if (busy || (query === search.query && regex === search.regex)) return
    setSearch({ scope: selectionScope, query, regex, scrollPositions: new Map() })
    setSelection({ scope: selectionScope, paths: new Set() })
  }

  function selectEntry(entry: FileEntry, selected: boolean) {
    setSelection((current) => {
      const paths = new Set(current.scope === selectionScope ? current.paths : [])
      if (selected) {
        paths.add(entry.path)
      } else {
        paths.delete(entry.path)
      }
      return { scope: selectionScope, paths }
    })
  }

  function selectAll(selected: boolean) {
    const paths = selected
      ? visibleEntries.filter((entry) => !isDriveRoot(entry.path)).map((entry) => entry.path)
      : []
    setSelection({
      scope: selectionScope,
      paths: new Set(paths),
    })
  }

  function beginTransfer(name: string, direction: Transfer['direction'], total: number) {
    const id = nextTransferId()
    setTransfers((current) => [...current, { id, name, direction, loaded: 0, total, samples: [] }])
    return id
  }

  function updateTransfer(id: string, loaded: number, total: number) {
    const time = performance.now()
    setTransfers((current) =>
      current.map((transfer) =>
        transfer.id === id
          ? { ...transfer, ...recordTransferProgress(transfer, loaded, total, time) }
          : transfer,
      ),
    )
  }

  function finishTransfer(id: string) {
    setTransfers((current) => current.filter((transfer) => transfer.id !== id))
  }

  function showCompletion(message: string) {
    setNotices((current) => [...current, { id: nextTransferId(), message }])
  }

  async function copyPath(entry: FileEntry) {
    setError(null)
    try {
      if (desktopRuntime) await desktopRuntime.Clipboard.SetText(entry.path)
      else await navigator.clipboard.writeText(entry.path)
      showCompletion('Copied path')
    } catch {
      setError('Could not copy the path. Check clipboard permission and try again.')
    }
  }

  async function refreshFiles() {
    const refreshed = await load(true)
    if (!refreshed) return

    const availablePaths = new Set(refreshed.map((entry) => entry.path))
    setSelection((current) => {
      if (current.scope !== selectionScope) return current
      const paths = new Set([...current.paths].filter((entryPath) => availablePaths.has(entryPath)))
      return { scope: selectionScope, paths }
    })
  }

  async function perform(operation: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await operation()
      await refreshFiles()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'File operation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function performDialog(operation: () => Promise<unknown>) {
    setBusy(true)
    try {
      await operation()
      await refreshFiles()
    } finally {
      setBusy(false)
    }
  }

  function uploadFiles(selected: FileList) {
    if (kind === 'vnc' && path === '/') {
      setError('Open a drive before uploading files.')
      return
    }
    if (path === null) {
      setError('Choose a remote path before uploading.')
      return
    }
    const uploads = Array.from(selected)
    if (uploads.length === 0) return
    void perform(async () => {
      for (const file of uploads) {
        const id = beginTransfer(file.name, 'upload', file.size)
        try {
          await files.upload(
            connectionId,
            joinRemotePath(path, file.name),
            file,
            (loaded, total) => {
              updateTransfer(id, loaded, total)
            },
          )
          showCompletion(`Uploaded ${file.name}`)
        } finally {
          finishTransfer(id)
        }
      }
    })
  }

  function enterFileDrag(event: DragEvent<HTMLDivElement>) {
    if (editingFile) return
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDropActive(true)
  }

  function leaveFileDrag(event: DragEvent<HTMLDivElement>) {
    if (editingFile) return
    if (!event.dataTransfer.types.includes('Files')) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    if (editingFile) return
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current = 0
    setDropActive(false)
    uploadFiles(event.dataTransfer.files)
  }

  async function download(entry: FileEntry, reportError = true): Promise<string | null> {
    if (reportError) setError(null)
    const id = beginTransfer(entry.name, 'download', entry.size)
    try {
      if (isDesktop) {
        const stopProgress = desktopRuntime?.Events.On('lightremote:download-progress', (event) => {
          const progress = event.data as { id?: string; loaded?: number }
          if (progress.id === id && typeof progress.loaded === 'number') {
            updateTransfer(id, progress.loaded, entry.size)
          }
        })
        try {
          const saved = await saveRemoteFile(connectionId, entry.path, entry.name, id)
          if (!saved) return 'Download canceled'
          showCompletion(`Downloaded ${entry.name}`)
        } finally {
          stopProgress?.()
        }
      } else {
        await files.download(connectionId, entry.path, entry.name, entry.size, (loaded, total) => {
          updateTransfer(id, loaded, total)
        })
        showCompletion(`Downloaded ${entry.name}`)
      }
      return null
    } catch (cause) {
      const message = errorMessage(cause)
      if (reportError) setError(message)
      return message
    } finally {
      finishTransfer(id)
    }
  }

  async function downloadSelected() {
    const toDownload = downloadableEntries
    const skipped = selectedEntries.length - toDownload.length
    if (toDownload.length === 0) return
    setBusy(true)
    setError(null)
    const failed: { path: string; message: string }[] = []
    const remainingPaths = new Set(selectedEntries.map((entry) => entry.path))
    let canceled = false
    try {
      for (const entry of toDownload) {
        const failure = await download(entry, false)
        if (failure === 'Download canceled') {
          canceled = true
          break
        }
        if (failure) {
          failed.push({ path: entry.path, message: `${entry.name}: ${failure}` })
        } else {
          remainingPaths.delete(entry.path)
        }
      }
      setSelection((current) =>
        current.scope === selectionScope
          ? { scope: selectionScope, paths: remainingPaths }
          : current,
      )
      if (failed.length || skipped || canceled) {
        setError(
          [
            failed.length
              ? `${failed.length} download(s) failed: ${failed.map((item) => item.message).join('; ')}`
              : '',
            skipped ? `${skipped} folder(s) skipped.` : '',
            canceled ? 'Remaining downloads were canceled.' : '',
          ]
            .filter(Boolean)
            .join(' '),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected(toDelete: FileEntry[]) {
    setBusy(true)
    setError(null)
    const failed: { path: string; message: string }[] = []
    try {
      for (const entry of toDelete) {
        try {
          await files.delete(connectionId, entry.path)
        } catch (cause) {
          failed.push({ path: entry.path, message: `${entry.name}: ${errorMessage(cause)}` })
        }
      }
      setSelection((current) =>
        current.scope === selectionScope
          ? { scope: selectionScope, paths: new Set(failed.map((item) => item.path)) }
          : current,
      )
      await refreshFiles()
      if (failed.length) {
        setError(
          `${failed.length} item(s) could not be deleted: ${failed.map((item) => item.message).join('; ')}`,
        )
      }
    } finally {
      setBusy(false)
    }
  }

  function navigateToPath(value: string, reloadIfSame = false) {
    const destination = normalizeRemotePath(kind, value)
    if (!destination) {
      setError(
        kind === 'vnc'
          ? 'Enter / or a drive path such as C:/.'
          : 'Enter an absolute remote path beginning with /.',
      )
      return
    }
    setError(null)
    if (destination === path) {
      if (reloadIfSame) void load()
      return
    }
    setSelecting(false)
    setSelection({ scope: `${connectionId}\0${destination}`, paths: new Set() })
    changePath(destination)
  }

  function toggleSort(field: FileSortField) {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <div
      className="file-manager"
      onDragEnter={enterFileDrag}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDragLeave={leaveFileDrag}
      onDrop={dropFiles}
    >
      {editingFile ? (
        <FileEditor
          connectionId={connectionId}
          entry={editingFile}
          onBack={() => setEditingFile(null)}
          onSaved={refreshFiles}
        />
      ) : (
        <>
          {selecting ? (
            <div className="files-toolbar files-selection-bar">
              <strong role="status">{selectedEntries.length} selected</strong>
              <div className="files-actions">
                <Tooltip title="Clear selection">
                  <IconButton
                    aria-label="Clear selection"
                    disabled={busy}
                    onClick={() => {
                      setSelection({ scope: selectionScope, paths: new Set() })
                      setSelecting(false)
                    }}
                  >
                    <Glyph name="close" size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Download selected files">
                  <IconButton
                    aria-label="Download selected files"
                    disabled={busy || downloadableEntries.length === 0}
                    onClick={() => void downloadSelected()}
                  >
                    <Glyph name="download" size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete selected items">
                  <IconButton
                    aria-label="Delete selected items"
                    disabled={busy || selectedEntries.length === 0}
                    onClick={() => setPending({ type: 'bulkDelete', entries: selectedEntries })}
                  >
                    <Glyph name="delete-outline" size={18} />
                  </IconButton>
                </Tooltip>
              </div>
            </div>
          ) : (
            <FileToolbar
              path={path}
              pathPlaceholder={kind === 'vnc' ? 'C:/path' : '/remote/path'}
              busy={busy}
              writeDisabled={kind === 'vnc' && path === '/'}
              onParent={() => navigateToPath(parentRemotePath(currentPath))}
              onNavigate={(value) => navigateToPath(value, true)}
              onRefresh={() => void refreshFiles()}
              onNewFolder={() => setPending({ type: 'mkdir' })}
              onUpload={uploadFiles}
              onStartSelection={() => setSelecting(true)}
            />
          )}
          <FileSearch
            query={search.query}
            regex={search.regex}
            error={searchPattern.error}
            disabled={busy || path === null}
            onQueryChange={(query) => updateSearch(query, search.regex)}
            onRegexChange={(regex) => updateSearch(search.query, regex)}
          />
          {error && (
            <div className="files-error" role="alert">
              {error}
            </div>
          )}
          <FileList
            directoryKey={listKey}
            scrollPositions={search.query ? search.scrollPositions : scrollPositions}
            hideActions={kind === 'vnc' && path === '/'}
            entries={visibleEntries}
            loading={loading || (!error && (path === null || loadedPath !== path))}
            loadingLabel={path === null ? 'Finding home directory…' : 'Loading files…'}
            showEmpty={path !== null && loadedPath === path && !error}
            emptyMessage={
              searchPattern.error
                ? 'Correct the regular expression to search.'
                : search.query && directoryEntries.length > 0
                  ? 'No matching files or folders.'
                  : 'This folder is empty.'
            }
            sort={sort}
            onSort={toggleSort}
            selecting={selecting}
            selectedPaths={selectedPaths}
            selectionDisabled={busy}
            onSelect={selectEntry}
            onSelectAll={selectAll}
            onOpen={(entry) => {
              if (kind === 'vnc' && currentPath === '/') {
                const drive = /^[A-Za-z]:/.exec(entry.name) ?? /[A-Za-z]:/.exec(entry.path)
                if (drive) {
                  navigateToPath(`${drive[0][0].toUpperCase()}:/`)
                  return
                }
              }
              navigateToPath(entry.path)
            }}
            onDownload={download}
            onEdit={setEditingFile}
            onCopyPath={copyPath}
            onRename={(entry, name) =>
              performDialog(() =>
                files.rename(connectionId, entry.path, joinRemotePath(currentPath, name)),
              )
            }
            onDelete={(entry) => setPending({ type: 'delete', entry })}
          />
          {transfers.length > 0 && (
            <div className="files-transfers" role="status" aria-live="polite">
              {transfers.map((transfer) => (
                <FileTransfer key={transfer.id} transfer={transfer} />
              ))}
            </div>
          )}
          <div className="files-footer">
            {search.query
              ? `${visibleEntries.length} of ${directoryEntries.length} items`
              : `${directoryEntries.length} items`}{' '}
            {busy && '· Working…'}
          </div>
        </>
      )}
      <DialogPresence>
        {pending?.type === 'mkdir' && (
          <TextPromptDialog
            title="New remote folder"
            label="Folder name"
            actionLabel="Create"
            onClose={() => setPending(null)}
            onConfirm={(name) =>
              performDialog(() => files.mkdir(connectionId, joinRemotePath(currentPath, name)))
            }
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {pending?.type === 'delete' && (
          <ConfirmDialog
            title="Delete remote entry"
            message={`Delete “${pending.entry.name}”? Directories must be empty.`}
            actionLabel="Delete"
            onClose={() => setPending(null)}
            onConfirm={() => performDialog(() => files.delete(connectionId, pending.entry.path))}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {pending?.type === 'bulkDelete' && (
          <ConfirmDialog
            title="Delete selected remote entries"
            message={`Delete ${pending.entries.length} selected item(s)? Directories must be empty.`}
            actionLabel="Delete"
            onClose={() => setPending(null)}
            onConfirm={() => deleteSelected(pending.entries)}
          />
        )}
      </DialogPresence>
      {dropActive && <div className="files-drop-overlay">Drop files to upload</div>}
      <Snackbar
        key={notices[0]?.id}
        open={notices.length > 0}
        autoHideDuration={4000}
        onClose={() => setNotices((current) => current.slice(1))}
      >
        <Alert severity="success" onClose={() => setNotices((current) => current.slice(1))}>
          {notices[0]?.message}
        </Alert>
      </Snackbar>
    </div>
  )
}
