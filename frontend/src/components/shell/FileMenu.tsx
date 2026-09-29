import { ListItemIcon, MenuItem, MenuList, Popover } from '@mui/material'
import { Glyph } from '../common/Glyph'

interface FileMenuProps {
  anchorEl: HTMLElement | null
  onClose: () => void
  onNewDirectConnection: () => void
}

export function FileMenu({ anchorEl, onClose, onNewDirectConnection }: FileMenuProps) {
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
        <MenuItem onClick={onNewDirectConnection}>
          <ListItemIcon>
            <Glyph name="add-link" size={17} />
          </ListItemIcon>
          New direct connection
        </MenuItem>
      </MenuList>
    </Popover>
  )
}
