import { useT } from '../../i18n/useT'
import { useState, type FormEvent } from 'react'
import { useDeleteFolderMutation, useUpdateFolderMutation } from '../../api/resources'
import type { Folder } from '../../types'
import { errorMessage } from '../../types'
import { DialogPresence, IconButton, Menu, MenuItem } from '../../ui'
import { classNames } from '../../utils/classNames'
import { ConfirmDialog } from '../common/ActionDialogs'
import { Glyph } from '../common/Glyph'
import { useSidebarDrag } from './SidebarDragContext'
import { itemKey, type SidebarItem } from './sidebarOrder'

interface FolderRowProps {
  folder: Folder
  open: boolean
  highlighted: boolean
  onToggle: () => void
  onAddItem: () => void
}

/** Renders a draggable folder with inline rename and deletion actions. */
export function FolderRow({ folder, open, highlighted, onToggle, onAddItem }: FolderRowProps) {
  const t = useT()

  const drag = useSidebarDrag()
  const item: SidebarItem = { kind: 'folder', id: folder.id, parentId: folder.parentId }
  const dropEdge =
    drag.dropTarget?.item && itemKey(drag.dropTarget.item) === itemKey(item)
      ? drag.dropTarget.edge
      : null
  const [updateFolder] = useUpdateFolderMutation()
  const [deleteFolder] = useDeleteFolderMutation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  /** Saves an inline name change while keeping the current parent. */
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name === folder.name) {
      setEditing(false)
      return
    }
    setRenameBusy(true)
    setRenameError(null)
    try {
      await updateFolder({ id: folder.id, name, parentId: folder.parentId }).unwrap()
      setEditing(false)
    } catch (cause) {
      setRenameError(errorMessage(cause))
    } finally {
      setRenameBusy(false)
    }
  }

  /** Deletes an empty folder after confirmation. */
  async function remove() {
    try {
      await deleteFolder(folder.id).unwrap()
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause })
    }
  }

  return (
    <>
      <div
        className={classNames(
          'folder-row',
          Boolean(anchor) && 'menu-open',
          highlighted && 'add-open',
          dropEdge && `sidebar-drop-${dropEdge}`,
          drag.dragging && itemKey(drag.dragging) === itemKey(item) && 'sidebar-dragging',
        )}
        draggable={!editing}
        onDragStart={(event) => drag.start(event, item)}
        onDragOver={(event) => drag.over(event, item)}
        onDrop={(event) => drag.drop(event, item)}
        onDragEnd={drag.end}
      >
        {editing ? (
          <form className="folder-rename" onSubmit={rename}>
            <span
              className={`folder-chevron ${open ? 'folder-chevron-open' : ''}`}
              aria-hidden="true"
            >
              <Glyph name="keyboard-arrow-right" size={17} />
            </span>
            <input
              aria-label={t('common.newName', { name: folder.name })}
              autoFocus
              required
              maxLength={255}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false)
              }}
              disabled={renameBusy}
            />
            <span className="sidebar-rename-actions">
              <IconButton
                type="submit"
                aria-label={t('connections.saveFolderName')}
                disabled={renameBusy}
              >
                <Glyph name="check" size={18} />
              </IconButton>
              <IconButton
                aria-label={t('connections.cancelRename')}
                onClick={() => setEditing(false)}
                disabled={renameBusy}
              >
                <Glyph name="close" size={18} />
              </IconButton>
            </span>
            {renameError && <small className="folder-rename-error">{renameError}</small>}
          </form>
        ) : (
          <>
            <button
              className="folder-toggle"
              aria-expanded={open}
              title={folder.name}
              onClick={onToggle}
            >
              <span
                className={`folder-chevron ${open ? 'folder-chevron-open' : ''}`}
                aria-hidden="true"
              >
                <Glyph name="keyboard-arrow-right" size={17} />
              </span>
              <span className="folder-name">{folder.name}</span>
            </button>
            <span className="sidebar-row-actions">
              <span className="sidebar-row-actions-inner">
                <IconButton
                  className="folder-add-button"
                  aria-label={t('common.addItemTo', { name: folder.name })}
                  title={t('connections.addItem')}
                  onClick={onAddItem}
                >
                  <Glyph name="add" size={16} />
                </IconButton>
                <IconButton
                  aria-label={t('common.actionsFor', { name: folder.name })}
                  title={t('connections.folderActions')}
                  onClick={(event) => {
                    setAnchor(event.currentTarget)
                    setMenuOpen(true)
                  }}
                >
                  <Glyph name="more-horiz" size={18} />
                </IconButton>
              </span>
            </span>
          </>
        )}
      </div>
      <Menu
        anchorEl={anchor}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onClosed={() => setAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            setName(folder.name)
            setRenameError(null)
            setEditing(true)
          }}
        >
          {t('connections.rename')}
        </MenuItem>
        <MenuItem
          className="mobile-folder-create"
          onClick={() => {
            setMenuOpen(false)
            onAddItem()
          }}
        >
          {t('connections.create')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            setConfirmDelete(true)
          }}
        >
          {t('connections.deleteFolder')}
        </MenuItem>
      </Menu>
      <DialogPresence>
        {confirmDelete && (
          <ConfirmDialog
            title={t('connections.deleteFolder')}
            message={t('connections.deleteFolder', { name: folder.name })}
            actionLabel={t('connections.delete')}
            onClose={() => setConfirmDelete(false)}
            onConfirm={remove}
          />
        )}
      </DialogPresence>
    </>
  )
}
