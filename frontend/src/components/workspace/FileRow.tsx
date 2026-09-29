import { useState, type FormEvent } from 'react'
import { IconButton, Tooltip } from '../../ui'
import type { FileEntry } from '../../types'
import { formatBytes } from '../../utils/formatBytes'
import { Glyph } from '../common/Glyph'
import { FileTypeIcon } from './FileTypeIcon'
import { isEditableTextFile, maxEditableBytes } from './editableFile'
import { isDriveRoot } from '../../utils/remoteFilePath'

interface FileRowProps {
  entry: FileEntry
  striped: boolean
  onOpen: (entry: FileEntry) => void
  onDownload: (entry: FileEntry) => void
  onEdit: (entry: FileEntry) => void
  onRename: (entry: FileEntry, name: string) => Promise<void>
  onDelete: (entry: FileEntry) => void
}

export function FileRow({
  entry,
  striped,
  onOpen,
  onDownload,
  onEdit,
  onRename,
  onDelete,
}: FileRowProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entry.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modifiedAt = Date.parse(entry.modTime)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name || name === '.' || name === '..' || name.includes('/')) {
      setError('Enter a name without a slash.')
      return
    }
    if (name === entry.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onRename(entry, name)
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rename failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`file-row ${striped ? 'file-row-striped' : ''}`} role="row">
      {editing ? (
        <form className="file-rename" onSubmit={submit}>
          <FileTypeIcon entry={entry} />
          <input
            aria-label={`New name for ${entry.name}`}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false)
            }}
            disabled={busy}
          />
          <IconButton type="submit" aria-label="Save name" disabled={busy}>
            <Glyph name="check" size={16} />
          </IconButton>
          <IconButton aria-label="Cancel rename" onClick={() => setEditing(false)} disabled={busy}>
            <Glyph name="close" size={16} />
          </IconButton>
          {error && <small className="file-rename-error">{error}</small>}
        </form>
      ) : (
        <button
          className="file-name"
          onClick={() => (entry.isDir ? onOpen(entry) : onDownload(entry))}
        >
          <FileTypeIcon entry={entry} />
          <span>{entry.name}</span>
        </button>
      )}
      <span>{entry.isDir ? '—' : formatBytes(entry.size)}</span>
      <span>{modifiedAt > 0 ? new Date(modifiedAt).toLocaleString() : '—'}</span>
      <div className="file-row-actions">
        {isEditableTextFile(entry) && (
          <Tooltip
            title={
              entry.size >= maxEditableBytes
                ? 'Files of 10 MB or larger cannot be edited'
                : 'Edit in browser'
            }
          >
            <span>
              <IconButton
                aria-label={`Edit ${entry.name}`}
                disabled={entry.size >= maxEditableBytes}
                onClick={() => onEdit(entry)}
              >
                <Glyph name="edit-note" size={17} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {!entry.isDir && (
          <Tooltip title="Download">
            <IconButton aria-label={`Download ${entry.name}`} onClick={() => onDownload(entry)}>
              <Glyph name="download" size={17} />
            </IconButton>
          </Tooltip>
        )}
        {!isDriveRoot(entry.path) && (
          <>
            <Tooltip title="Rename">
              <IconButton
                aria-label={`Rename ${entry.name}`}
                onClick={() => {
                  setName(entry.name)
                  setError(null)
                  setEditing(true)
                }}
              >
                <Glyph name="drive-file-rename-outline" size={17} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton aria-label={`Delete ${entry.name}`} onClick={() => onDelete(entry)}>
                <Glyph name="delete-outline" size={17} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}
