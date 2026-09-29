import { useState, type FormEvent } from 'react'
import { IconButton, Menu, MenuItem } from '../../ui'
import type { FileEntry } from '../../types'
import { formatBytes } from '../../utils/formatBytes'
import { Glyph } from '../common/Glyph'
import { FileTypeIcon } from './FileTypeIcon'
import { isEditableTextFile, maxEditableBytes } from './editableFile'
import { isDriveRoot } from '../../utils/remoteFilePath'

interface FileRowProps {
  entry: FileEntry
  striped: boolean
  selected: boolean
  selectionDisabled: boolean
  onSelect: (entry: FileEntry, selected: boolean) => void
  onOpen: (entry: FileEntry) => void
  onDownload: (entry: FileEntry) => void
  onEdit: (entry: FileEntry) => void
  onRename: (entry: FileEntry, name: string) => Promise<void>
  onDelete: (entry: FileEntry) => void
}

export function FileRow({
  entry,
  striped,
  selected,
  selectionDisabled,
  onSelect,
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const modifiedAt = Date.parse(entry.modTime)
  const driveRoot = isDriveRoot(entry.path)

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
      <span role="cell" className="file-selection-cell">
        <input
          type="checkbox"
          aria-label={`Select ${entry.name}`}
          checked={selected}
          disabled={driveRoot || selectionDisabled}
          onChange={(event) => onSelect(entry, event.target.checked)}
        />
      </span>
      <div className="file-name-cell" role="cell">
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
            <IconButton
              aria-label="Cancel rename"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
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
      </div>
      <span role="cell">{entry.isDir ? '—' : formatBytes(entry.size)}</span>
      <span role="cell">{modifiedAt > 0 ? new Date(modifiedAt).toLocaleString() : '—'}</span>
      <div className="file-row-actions" role="cell">
        {!driveRoot && (
          <IconButton
            aria-label={`Actions for ${entry.name}`}
            onClick={(event) => {
              setAnchor(event.currentTarget)
              setMenuOpen(true)
            }}
          >
            <Glyph name="more-vert" size={18} />
          </IconButton>
        )}
        <Menu
          anchorEl={anchor}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onClosed={() => setAnchor(null)}
        >
          {isEditableTextFile(entry) && (
            <MenuItem
              disabled={entry.size >= maxEditableBytes}
              onClick={() => {
                setMenuOpen(false)
                onEdit(entry)
              }}
            >
              {entry.size >= maxEditableBytes ? 'Edit (10 MB limit)' : 'Edit'}
            </MenuItem>
          )}
          {!entry.isDir && (
            <MenuItem
              onClick={() => {
                setMenuOpen(false)
                onDownload(entry)
              }}
            >
              Download
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              setMenuOpen(false)
              setName(entry.name)
              setError(null)
              setEditing(true)
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuOpen(false)
              onDelete(entry)
            }}
          >
            Delete
          </MenuItem>
        </Menu>
      </div>
    </div>
  )
}
