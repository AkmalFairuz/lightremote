import { useT } from '../../i18n/useT'
import { translateMessage } from '../../i18n'
import { useLocale } from '../../i18n/useLocale'
import { ListItemIcon, MenuItem, MenuList, Paper, Popover, Popper } from '@mui/material'
import { useState } from 'react'
import { useColorScheme } from '@mui/material/styles'
import { Glyph } from '../common/Glyph'
import { terminalThemeOptions } from '../workspace/terminalTheme'
import {
  setTerminalThemePreference,
  useTerminalThemePreference,
} from '../workspace/terminalThemePreference'

interface ViewMenuProps {
  anchorEl: HTMLElement | null
  section: ViewSection
  onSection: (section: ViewSection) => void
  onClose: () => void
}

export type ViewSection = 'root' | 'appearance' | 'terminal'

/** Opens appearance and terminal colors beside the parent View menu. */
export function ViewMenu({ anchorEl, section, onSection, onClose }: ViewMenuProps) {
  const t = useT()

  const locale = useLocale()
  const rtl = locale === 'ar'

  const { mode, setMode } = useColorScheme()
  const terminalTheme = useTerminalThemePreference()
  const [submenuAnchor, setSubmenuAnchor] = useState<HTMLElement | null>(null)

  function openSection(next: Exclude<ViewSection, 'root'>, element: HTMLElement) {
    setSubmenuAnchor(element)
    onSection(next)
  }

  function closeMenu() {
    setSubmenuAnchor(null)
    onSection('root')
    onClose()
  }

  return (
    <>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={closeMenu}
        disableEnforceFocus
        anchorOrigin={{ vertical: 'bottom', horizontal: rtl ? 'right' : 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: rtl ? 'right' : 'left' }}
        slotProps={{ paper: { className: 'view-popover' } }}
      >
        <MenuList dense aria-label={t('shell.viewSettings')}>
          <MenuItem
            selected={section === 'appearance'}
            aria-haspopup="menu"
            aria-expanded={section === 'appearance'}
            onMouseEnter={(event) => openSection('appearance', event.currentTarget)}
            onClick={(event) => openSection('appearance', event.currentTarget)}
          >
            <ListItemIcon>
              <Glyph name="palette-outline" size={17} />
            </ListItemIcon>
            {t('shell.appearance')}
            <Glyph name="chevron-right" size={18} />
          </MenuItem>
          <MenuItem
            selected={section === 'terminal'}
            aria-haspopup="menu"
            aria-expanded={section === 'terminal'}
            onMouseEnter={(event) => openSection('terminal', event.currentTarget)}
            onClick={(event) => openSection('terminal', event.currentTarget)}
          >
            <ListItemIcon>
              <Glyph name="terminal" size={17} />
            </ListItemIcon>
            {t('shell.terminalTheme')}
            <Glyph name="chevron-right" size={18} />
          </MenuItem>
        </MenuList>
      </Popover>
      <Popper
        open={Boolean(anchorEl && submenuAnchor && section !== 'root')}
        anchorEl={submenuAnchor}
        placement={rtl ? 'left-start' : 'right-start'}
        className="view-submenu"
        modifiers={[
          {
            name: 'flip',
            options: { fallbackPlacements: [rtl ? 'right-start' : 'left-start', 'bottom-start'] },
          },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
      >
        <Paper className="view-submenu-paper" elevation={6}>
          <MenuList
            dense
            aria-label={section === 'appearance' ? t('shell.appearance') : t('shell.terminalTheme')}
          >
            {section === 'appearance' && (
              <>
                <MenuItem
                  selected={mode === 'system'}
                  onClick={() => {
                    setMode('system')
                    closeMenu()
                  }}
                >
                  {t('shell.systemMode')}
                  {mode === 'system' && <Glyph name="check" size={16} />}
                </MenuItem>
                <MenuItem
                  selected={mode === 'light'}
                  onClick={() => {
                    setMode('light')
                    closeMenu()
                  }}
                >
                  {t('shell.lightMode')}
                  {mode === 'light' && <Glyph name="check" size={16} />}
                </MenuItem>
                <MenuItem
                  selected={mode === 'dark'}
                  onClick={() => {
                    setMode('dark')
                    closeMenu()
                  }}
                >
                  {t('shell.darkMode')}
                  {mode === 'dark' && <Glyph name="check" size={16} />}
                </MenuItem>
              </>
            )}
            {section === 'terminal' && (
              <>
                {terminalThemeOptions.map((option) => (
                  <MenuItem
                    key={option.name}
                    selected={terminalTheme === option.name}
                    onClick={() => {
                      setTerminalThemePreference(option.name)
                      closeMenu()
                    }}
                  >
                    {translateMessage(option.label, locale)}
                    {terminalTheme === option.name && <Glyph name="check" size={16} />}
                  </MenuItem>
                ))}
              </>
            )}
          </MenuList>
        </Paper>
      </Popper>
    </>
  )
}
