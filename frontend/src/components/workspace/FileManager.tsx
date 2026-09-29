import { useMemo, useRef, useState, type DragEvent } from 'react'
import { files } from '../../api/files'
import { DialogPresence } from '../../ui'
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
import { errorMessage } from '../../types'

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
  const [dropActive, setDropActive] = useState(false)
  const [editingFile, setEditingFile] = useState<FileEntry | null>(null)
  const [pending, setPending] = useState<
    { type: 'delete'; entry: FileEntry } | { type: 'mkdir' } | null
  >(null)
  const dragDepth = useRef(0)

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
        await files.upload(connectionId, joinRemotePath(path, file.name), file)
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

  function download(entry: FileEntry) {
    if (isDesktop) {
      void saveRemoteFile(connectionId, entry.path, entry.name).catch((cause) =>
        setError(errorMessage(cause)),
      )
      return
    }
    const link = document.createElement('a')
    link.href = files.downloadURL(connectionId, entry.path)
    link.download = entry.name
    link.click()
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
    </div>
  )
}
