import { ListItemIcon, MenuItem, MenuList, Popover } from '@mui/material'
import { Glyph } from '../common/Glyph'
import { desktopRuntime } from '../../desktop/runtime'

interface HelpMenuProps {
  anchorEl: HTMLElement | null
  onClose: () => void
  onAbout: () => void
}

export function HelpMenu({ anchorEl, onClose, onAbout }: HelpMenuProps) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      disableEnforceFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { className: 'help-popover' } }}
    >
      <MenuList dense aria-label="Help links">
        <MenuItem
          onClick={() => {
            onClose()
            onAbout()
          }}
        >
          <ListItemIcon>
            <Glyph name="info-outline" size={17} />
          </ListItemIcon>
          About LightRemote
        </MenuItem>
        <MenuItem
          component="a"
          href="https://github.com/AkmalFairuz/lightremote"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            onClose()
            if (desktopRuntime) {
              event.preventDefault()
              void desktopRuntime.Browser.OpenURL('https://github.com/AkmalFairuz/lightremote')
            }
          }}
        >
          <ListItemIcon>
            <Glyph name="code" size={17} />
          </ListItemIcon>
          Source Code
        </MenuItem>
      </MenuList>
    </Popover>
  )
}
