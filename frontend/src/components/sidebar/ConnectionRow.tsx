import { useState, type CSSProperties, type FormEvent } from 'react'
import { DialogPresence, IconButton, Menu, MenuItem } from '../../ui'
import {
  useDeleteConnectionMutation,
  useDuplicateConnectionMutation,
  useRenameConnectionMutation,
} from '../../api/resources'
import { useAppDispatch } from '../../state/hooks'
import { closeConnectionTabs, renameConnectionTabs } from '../../state/workspaceSlice'
import { errorMessage, type Connection } from '../../types'
import { classNames } from '../../utils/classNames'
import { ConfirmDialog } from '../common/ActionDialogs'
import { useSidebarDrag } from './SidebarDragContext'
import { itemKey, type SidebarItem } from './sidebarOrder'
import { Glyph } from '../common/Glyph'
import { sidebarIndentPixels } from './sidebarDimensions'

interface ConnectionRowProps {
  connection: Connection
  contentWidth: number
  depth?: number
  onOpen: (connection: Connection) => void
  onEdit: (connection: Connection) => void
  onHostKey: (connection: Connection) => void
  onNotice: (message: string) => void
}

const kindIcons = {
  ssh: 'terminal',
  vnc: 'desktop-windows-outline',
  sftp: 'folder-shared-outline',
  ftp: 'folder-outline',
}

export function ConnectionRow({
  connection,
  contentWidth,
  depth = 0,
  onOpen,
  onEdit,
  onHostKey,
  onNotice,
}: ConnectionRowProps) {
  const drag = useSidebarDrag()
  const item: SidebarItem = { kind: 'connection', id: connection.id, parentId: connection.folderId }
  const dropEdge =
    drag.dropTarget?.item && itemKey(drag.dropTarget.item) === itemKey(item)
      ? drag.dropTarget.edge
      : null
  const dispatch = useAppDispatch()
  const [deleteConnection] = useDeleteConnectionMutation()
  const [renameConnection] = useRenameConnectionMutation()
  const [duplicateConnection, { isLoading: duplicating }] = useDuplicateConnectionMutation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(connection.name)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  async function rename(event: FormEvent) {
    event.preventDefault()
    if (name === connection.name) {
      setEditing(false)
      return
    }
    setRenameBusy(true)
    setRenameError(null)
    try {
      await renameConnection({ id: connection.id, name }).unwrap()
      dispatch(renameConnectionTabs({ connectionId: connection.id, name }))
      setEditing(false)
    } catch (cause) {
      setRenameError(errorMessage(cause))
    } finally {
      setRenameBusy(false)
    }
  }

  async function remove() {
    try {
      await deleteConnection(connection.id).unwrap()
      dispatch(closeConnectionTabs(connection.id))
    } catch (error) {
      throw new Error(errorMessage(error), { cause: error })
    }
  }

  async function duplicate() {
    try {
      await duplicateConnection(connection.id).unwrap()
    } catch (cause) {
      onNotice(errorMessage(cause))
    }
  }

  return (
    <div
      className={classNames(
        'connection-row',
        Boolean(anchor) && 'menu-open',
        dropEdge && `sidebar-drop-${dropEdge}`,
        drag.dragging && itemKey(drag.dragging) === itemKey(item) && 'sidebar-dragging',
      )}
      style={
        {
          width: contentWidth ? Math.max(0, contentWidth - depth * sidebarIndentPixels) : undefined,
          '--sidebar-indent': `${depth * sidebarIndentPixels}px`,
        } as CSSProperties
      }
      role="treeitem"
      draggable={!editing}
      onDragStart={(event) => drag.start(event, item)}
      onDragOver={(event) => drag.over(event, item)}
      onDrop={(event) => drag.drop(event, item)}
      onDragEnd={drag.end}
    >
      {editing ? (
        <form className="connection-rename" onSubmit={rename}>
          <Glyph name={kindIcons[connection.kind]} size={17} />
          <input
            aria-label={`New name for ${connection.name}`}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false)
            }}
            disabled={renameBusy}
          />
          <span className="sidebar-rename-actions">
            <IconButton type="submit" aria-label="Save connection name" disabled={renameBusy}>
              <Glyph name="check" size={18} />
            </IconButton>
            <IconButton
              aria-label="Cancel rename"
              onClick={() => setEditing(false)}
              disabled={renameBusy}
            >
              <Glyph name="close" size={18} />
            </IconButton>
          </span>
          {renameError && <small className="connection-rename-error">{renameError}</small>}
        </form>
      ) : (
        <>
          <button
            className="connection-open"
            onClick={() => onOpen(connection)}
            title={`${connection.name} · ${connection.kind.toUpperCase()} · ${connection.host}`}
          >
            <Glyph name={kindIcons[connection.kind]} size={17} />
            <span>{connection.name}</span>
          </button>
          <span className="sidebar-row-actions">
            <span className="sidebar-row-actions-inner">
              <IconButton
                aria-label={`Actions for ${connection.name}`}
                onClick={(event) => {
                  setAnchor(event.currentTarget)
                  setMenuOpen(true)
                }}
              >
                <Glyph name="more-vert" size={17} />
              </IconButton>
            </span>
          </span>
        </>
      )}
      <Menu
        anchorEl={anchor}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onClosed={() => setAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            setName(connection.name)
            setRenameError(null)
            setEditing(true)
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            onEdit(connection)
          }}
        >
          Edit connection
        </MenuItem>
        <MenuItem
          disabled={duplicating}
          onClick={() => {
            setMenuOpen(false)
            void duplicate()
          }}
        >
          Duplicate connection
        </MenuItem>
        {(connection.kind === 'ssh' || connection.kind === 'sftp') && (
          <MenuItem
            onClick={() => {
              setMenuOpen(false)
              onHostKey(connection)
            }}
          >
            SSH host key
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            setConfirmDelete(true)
          }}
        >
          Delete connection
        </MenuItem>
      </Menu>
      <DialogPresence>
        {confirmDelete && (
          <ConfirmDialog
            title="Delete connection"
            message={`Delete “${connection.name}”?`}
            actionLabel="Delete"
            onClose={() => setConfirmDelete(false)}
            onConfirm={remove}
          />
        )}
      </DialogPresence>
    </div>
  )
}
