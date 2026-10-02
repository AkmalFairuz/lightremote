import { useT } from '../../i18n/useT'
import { useLocale } from '../../i18n/useLocale'
import { ListItemIcon, MenuItem, MenuList, Popover } from '@mui/material'
import { Glyph } from '../common/Glyph'
import { desktopRuntime } from '../../desktop/runtime'

interface HelpMenuProps {
  anchorEl: HTMLElement | null
  onClose: () => void
  onAbout: () => void
}

export function HelpMenu({ anchorEl, onClose, onAbout }: HelpMenuProps) {
  const t = useT()

  const rtl = useLocale() === 'ar'

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      disableEnforceFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: rtl ? 'right' : 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: rtl ? 'right' : 'left' }}
      slotProps={{ paper: { className: 'help-popover' } }}
    >
      <MenuList dense aria-label={t('shell.helpLinks')}>
        <MenuItem
          onClick={() => {
            onClose()
            onAbout()
          }}
        >
          <ListItemIcon>
            <Glyph name="info-outline" size={17} />
          </ListItemIcon>
          {t('shell.aboutLightremote')}
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
          {t('shell.sourceCode')}
        </MenuItem>
      </MenuList>
    </Popover>
  )
}
