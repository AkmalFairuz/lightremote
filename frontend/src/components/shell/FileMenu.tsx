import { ListItemIcon, MenuItem, MenuList, Paper, Popover, Popper } from '@mui/material'
import { useState } from 'react'
import type { Connection } from '../../types'
import {
  newDirectConnectionShortcut,
  openConnectionShortcut,
} from '../../utils/connectionShortcuts'
import { Glyph } from '../common/Glyph'

interface FileMenuProps {
  anchorEl: HTMLElement | null
  section: FileSection
  onSection: (section: FileSection) => void
  onClose: () => void
  onOpenConnection: () => void
  onNewDirectConnection: () => void
  recentConnections: Connection[]
  onOpenRecentConnection: (connection: Connection) => void
}

export type FileSection = 'root' | 'recent'

export function FileMenu({
  anchorEl,
  section,
  onSection,
  onClose,
  onOpenConnection,
  onNewDirectConnection,
  recentConnections,
  onOpenRecentConnection,
}: FileMenuProps) {
  const [submenuAnchor, setSubmenuAnchor] = useState<HTMLElement | null>(null)

  function closeMenu() {
    setSubmenuAnchor(null)
    onClose()
  }

  function openRecent(element: HTMLElement) {
    setSubmenuAnchor(element)
    onSection('recent')
  }

  return (
    <>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={closeMenu}
        disableEnforceFocus
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { className: 'file-popover' } }}
      >
        <MenuList dense aria-label="File actions">
          <MenuItem onMouseEnter={() => onSection('root')} onClick={onOpenConnection}>
            <ListItemIcon>
              <Glyph name="search" size={17} />
            </ListItemIcon>
            <span>Open connection</span>
            <span className="file-menu-shortcut">{openConnectionShortcut}</span>
          </MenuItem>
          <MenuItem onMouseEnter={() => onSection('root')} onClick={onNewDirectConnection}>
            <ListItemIcon>
              <Glyph name="add-link" size={17} />
            </ListItemIcon>
            <span>New direct connection</span>
            <span className="file-menu-shortcut">{newDirectConnectionShortcut}</span>
          </MenuItem>
          <MenuItem
            selected={section === 'recent'}
            disabled={recentConnections.length === 0}
            aria-haspopup="menu"
            aria-expanded={section === 'recent'}
            onMouseEnter={(event) => openRecent(event.currentTarget)}
            onClick={(event) => openRecent(event.currentTarget)}
          >
            <ListItemIcon>
              <Glyph name="history" size={17} />
            </ListItemIcon>
            Recent connections
            <Glyph name="chevron-right" size={18} />
          </MenuItem>
        </MenuList>
      </Popover>
      <Popper
        open={Boolean(anchorEl && submenuAnchor && section === 'recent')}
        anchorEl={submenuAnchor}
        placement="right-start"
        className="file-submenu"
        modifiers={[
          { name: 'flip', options: { fallbackPlacements: ['left-start', 'bottom-start'] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
      >
        <Paper className="file-submenu-paper" elevation={6}>
          <MenuList dense aria-label="Recent connections">
            {recentConnections.map((connection) => (
              <MenuItem
                key={connection.id}
                className="file-recent-item"
                title={`${connection.name} · ${connection.kind.toUpperCase()} · ${connection.host}`}
                onClick={() => {
                  closeMenu()
                  onOpenRecentConnection(connection)
                }}
              >
                <span className="file-recent-name">{connection.name}</span>
                <small>{connection.kind.toUpperCase()}</small>
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      </Popper>
    </>
  )
}
