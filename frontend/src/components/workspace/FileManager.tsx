import { useMemo, useRef, useState, type DragEvent } from 'react'
import { files } from '../../api/files'
import { Alert, DialogPresence, Snackbar } from '../../ui'
import type { ConnectionKind, FileEntry } from '../../types'
import { ConfirmDialog, TextPromptDialog } from '../common/ActionDialogs'
import { FileList } from './FileList'
import { FileEditor } from './FileEditor'
import { FileToolbar } from './FileToolbar'
import { sortFileEntries, type FileSort, type FileSortField } from './fileSort'
import { joinRemotePath, normalizeRemotePath, parentRemotePath } from '../../utils/remoteFilePath'
import { useRemoteDirectory } from './useRemoteDirectory'
import { saveRemoteFile } from '../../desktop/actions'
import { isDesktop } from '../../desktop/viewerSocket'
import { desktopRuntime } from '../../desktop/runtime'
import { errorMessage } from '../../types'
import { formatBytes } from '../../utils/formatBytes'

interface Transfer {
  id: string
  name: string
  direction: 'upload' | 'download'
  loaded: number
  total: number
}

interface Notice {
  id: string
  message: string
}

const transferNamespace = Math.random().toString(36).slice(2)
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
  const [sort, setSort] = useState<FileSort>({ field: 'name', direction: 'asc' })
  const sortedEntries = useMemo(() => sortFileEntries(entries, sort), [entries, sort])
  const [busy, setBusy] = useState(false)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [dropActive, setDropActive] = useState(false)
  const [editingFile, setEditingFile] = useState<FileEntry | null>(null)
  const [pending, setPending] = useState<
    { type: 'delete'; entry: FileEntry } | { type: 'mkdir' } | null
  >(null)
  const dragDepth = useRef(0)

  function beginTransfer(name: string, direction: Transfer['direction'], total: number) {
    const id = nextTransferId()
    setTransfers((current) => [...current, { id, name, direction, loaded: 0, total }])
    return id
  }

  function updateTransfer(id: string, loaded: number, total: number) {
    setTransfers((current) =>
      current.map((transfer) => (transfer.id === id ? { ...transfer, loaded, total } : transfer)),
    )
  }

  function finishTransfer(id: string) {
    setTransfers((current) => current.filter((transfer) => transfer.id !== id))
  }

  function showCompletion(message: string) {
    setNotices((current) => [...current, { id: nextTransferId(), message }])
  }

  async function perform(operation: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await operation()
      await load(true)
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
      await load(true)
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

  async function download(entry: FileEntry) {
    setError(null)
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
          if (saved) showCompletion(`Downloaded ${entry.name}`)
        } finally {
          stopProgress?.()
        }
      } else {
        await files.download(connectionId, entry.path, entry.name, entry.size, (loaded, total) => {
          updateTransfer(id, loaded, total)
        })
        showCompletion(`Downloaded ${entry.name}`)
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      finishTransfer(id)
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
          onSaved={() => load(true)}
        />
      ) : (
        <>
          <FileToolbar
            path={path}
            pathPlaceholder={kind === 'vnc' ? 'C:/path' : '/remote/path'}
            busy={busy}
            writeDisabled={kind === 'vnc' && path === '/'}
            onParent={() => navigateToPath(parentRemotePath(currentPath))}
            onNavigate={(value) => navigateToPath(value, true)}
            onRefresh={() => void load(true)}
            onNewFolder={() => setPending({ type: 'mkdir' })}
            onUpload={uploadFiles}
          />
          {error && (
            <div className="files-error" role="alert">
              {error}
            </div>
          )}
          <FileList
            hideActions={kind === 'vnc' && path === '/'}
            entries={loadedPath === path ? sortedEntries : []}
            loading={loading || (!error && (path === null || loadedPath !== path))}
            loadingLabel={path === null ? 'Finding home directory…' : 'Loading files…'}
            showEmpty={path !== null && loadedPath === path && !error}
            sort={sort}
            onSort={toggleSort}
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
            onRename={(entry, name) =>
              performDialog(() =>
                files.rename(connectionId, entry.path, joinRemotePath(currentPath, name)),
              )
            }
            onDelete={(entry) => setPending({ type: 'delete', entry })}
          />
          {transfers.length > 0 && (
            <div className="files-transfers" role="status" aria-live="polite">
              {transfers.map((transfer) => {
                const percent =
                  transfer.total > 0
                    ? Math.min(100, Math.round((transfer.loaded / transfer.total) * 100))
                    : undefined
                const action = transfer.direction === 'upload' ? 'Uploading' : 'Downloading'
                return (
                  <div className="files-transfer" key={transfer.id}>
                    <div className="files-transfer-label">
                      <span>
                        {action} {transfer.name}
                      </span>
                      <span>
                        {formatBytes(transfer.loaded)}
                        {transfer.total > 0 && ` / ${formatBytes(transfer.total)}`}
                        {percent === 100 && ' · Finishing…'}
                      </span>
                    </div>
                    <progress
                      aria-label={`${action} ${transfer.name}`}
                      max={transfer.total > 0 ? transfer.total : undefined}
                      value={
                        transfer.total > 0 ? Math.min(transfer.loaded, transfer.total) : undefined
                      }
                    />
                  </div>
                )
              })}
            </div>
          )}
          <div className="files-footer">
            {loadedPath === path ? entries.length : 0} items {busy && '· Working…'}
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
