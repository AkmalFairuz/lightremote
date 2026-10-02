import { useT } from '../../i18n/useT'
import { formatDate } from '../../i18n/format'
import { translateMessage } from '../../i18n'
import { useLocale } from '../../i18n/useLocale'
import { useEffect, useState, type FormEvent } from 'react'
import { IconButton, Menu, MenuItem } from '../../ui'
import type { FileEntry } from '../../types'
import { formatBytes } from '../../utils/formatBytes'
import { Glyph } from '../common/Glyph'
import { FileTypeIcon } from './FileTypeIcon'
import { isEditableTextFile, maxEditableBytes } from './editableFile'
import { isDriveRoot } from '../../utils/remoteFilePath'

interface FileRowProps {
  entry: FileEntry
  index: number
  striped: boolean
  selected: boolean
  selecting: boolean
  selectionDisabled: boolean
  onSelect: (entry: FileEntry, selected: boolean) => void
  onOpen: (entry: FileEntry) => void
  onDownload: (entry: FileEntry) => void
  onEdit: (entry: FileEntry) => void
  onCopyPath: (entry: FileEntry) => void
  onRename: (entry: FileEntry, name: string) => Promise<void>
  onDelete: (entry: FileEntry) => void
  onActiveChange: (path: string, active: boolean) => void
}

export function FileRow({
  entry,
  index,
  striped,
  selected,
  selecting,
  selectionDisabled,
  onSelect,
  onOpen,
  onDownload,
  onEdit,
  onCopyPath,
  onRename,
  onDelete,
  onActiveChange,
}: FileRowProps) {
  const t = useT()

  const locale = useLocale()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entry.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const modifiedAt = Date.parse(entry.modTime)
  const modifiedLabel = modifiedAt > 0 ? formatDate(new Date(modifiedAt), locale) : '—'
  const driveRoot = isDriveRoot(entry.path)
  const active = focused || editing || anchor !== null

  useEffect(() => {
    onActiveChange(entry.path, active)
    return () => onActiveChange(entry.path, false)
  }, [entry.path, active, onActiveChange])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name || name === '.' || name === '..' || name.includes('/')) {
      setError(t('common.enterANameWithoutASlash'))
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
      setError(cause instanceof Error ? cause.message : t('files.renameFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`file-row ${striped ? 'file-row-striped' : ''}`}
      style={{ top: `calc(${index} * var(--files-row-height))` }}
      role="row"
      aria-rowindex={index + 2}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      {selecting && (
        <span role="cell" className="file-selection-cell">
          <input
            type="checkbox"
            aria-label={t('common.selectNamed', { name: entry.name })}
            checked={selected}
            disabled={driveRoot || selectionDisabled}
            onChange={(event) => onSelect(entry, event.target.checked)}
          />
        </span>
      )}
      <div className="file-name-cell" role="cell">
        {editing ? (
          <form className="file-rename" onSubmit={submit}>
            <FileTypeIcon entry={entry} />
            <input
              aria-label={t('common.newName', { name: entry.name })}
              aria-invalid={Boolean(error)}
              title={error ?? undefined}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false)
              }}
              disabled={busy}
            />
            <IconButton type="submit" aria-label={t('files.saveName')} disabled={busy}>
              <Glyph name="check" size={16} />
            </IconButton>
            <IconButton
              aria-label={t('connections.cancelRename')}
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              <Glyph name="close" size={16} />
            </IconButton>
            {error && (
              <small className="file-rename-error" role="alert">
                {translateMessage(error, locale)}
              </small>
            )}
          </form>
        ) : (
          <button
            className="file-name"
            title={entry.name}
            disabled={selecting && (driveRoot || selectionDisabled)}
            onClick={() => {
              if (selecting) onSelect(entry, !selected)
              else if (entry.isDir) onOpen(entry)
              else onDownload(entry)
            }}
          >
            <FileTypeIcon entry={entry} />
            <span>{entry.name}</span>
          </button>
        )}
      </div>
      <span
        role="cell"
        className="file-metadata-cell"
        title={entry.isDir ? undefined : formatBytes(entry.size, locale)}
      >
        {entry.isDir ? '—' : formatBytes(entry.size, locale)}
      </span>
      <span role="cell" className="file-metadata-cell" title={modifiedLabel}>
        {modifiedLabel}
      </span>
      <div className="file-row-actions" role="cell">
        {!driveRoot && (
          <IconButton
            aria-label={t('common.actionsFor', { name: entry.name })}
            onClick={(event) => {
              setAnchor(event.currentTarget)
              setMenuOpen(true)
            }}
          >
            <Glyph name="more-vert" size={18} />
          </IconButton>
        )}
        {anchor && (
          <Menu
            anchorEl={anchor}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onClosed={() => setAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                setMenuOpen(false)
                onCopyPath(entry)
              }}
            >
              {t('files.copyPath')}
            </MenuItem>
            {isEditableTextFile(entry) && (
              <MenuItem
                disabled={entry.size >= maxEditableBytes}
                onClick={() => {
                  setMenuOpen(false)
                  onEdit(entry)
                }}
              >
                {entry.size >= maxEditableBytes ? t('files.edit10MbLimit') : t('users.edit')}
              </MenuItem>
            )}
            {!entry.isDir && (
              <MenuItem
                onClick={() => {
                  setMenuOpen(false)
                  onDownload(entry)
                }}
              >
                {t('files.download')}
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
              {t('connections.rename')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuOpen(false)
                onDelete(entry)
              }}
            >
              {t('connections.delete')}
            </MenuItem>
          </Menu>
        )}
      </div>
    </div>
  )
}
