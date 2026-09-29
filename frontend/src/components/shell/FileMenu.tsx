import { ListItemIcon, MenuItem, MenuList, Popover } from '@mui/material'
import {
  newDirectConnectionShortcut,
  openConnectionShortcut,
} from '../../utils/connectionShortcuts'
import { Glyph } from '../common/Glyph'

interface FileMenuProps {
  anchorEl: HTMLElement | null
  onClose: () => void
  onOpenConnection: () => void
  onNewDirectConnection: () => void
}

export function FileMenu({
  anchorEl,
  onClose,
  onOpenConnection,
  onNewDirectConnection,
}: FileMenuProps) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { className: 'file-popover' } }}
    >
      <MenuList dense aria-label="File actions">
        <MenuItem onClick={onOpenConnection}>
          <ListItemIcon>
            <Glyph name="search" size={17} />
          </ListItemIcon>
          <span>Open connection</span>
          <span className="file-menu-shortcut">{openConnectionShortcut}</span>
        </MenuItem>
        <MenuItem onClick={onNewDirectConnection}>
          <ListItemIcon>
            <Glyph name="add-link" size={17} />
          </ListItemIcon>
          <span>New direct connection</span>
          <span className="file-menu-shortcut">{newDirectConnectionShortcut}</span>
        </MenuItem>
      </MenuList>
    </Popover>
  )
}
