import { useT } from '../../i18n/useT'
import { useLocale } from '../../i18n/useLocale'
import { ListItemIcon, MenuItem, MenuList, Popover, Typography } from '@mui/material'
import { useAppSelector } from '../../state/hooks'
import { Glyph } from '../common/Glyph'

interface AccountPopoverProps {
  anchorEl: HTMLElement | null
  onClose: () => void
  onChangePassword: () => void
  onManageUsers: () => void
  onSignOut: () => void
}

/** Offers account actions from the navbar without embedding forms in the menu. */
export function AccountPopover({
  anchorEl,
  onClose,
  onChangePassword,
  onManageUsers,
  onSignOut,
}: AccountPopoverProps) {
  const t = useT()

  const rtl = useLocale() === 'ar'

  const user = useAppSelector((state) => state.auth.user)

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      disableEnforceFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: rtl ? 'right' : 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: rtl ? 'right' : 'left' }}
      slotProps={{ paper: { className: 'account-popover' } }}
    >
      <div className="account-popover-heading">
        <Typography variant="subtitle2" noWrap>
          {user?.email}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {user?.role === 'admin' ? t('shell.administrator') : t('shell.user')}
        </Typography>
      </div>
      <MenuList>
        <MenuItem onClick={onChangePassword}>
          <ListItemIcon>
            <Glyph name="lock-outline" size={18} />
          </ListItemIcon>
          {t('shell.changePassword')}
        </MenuItem>
        {user?.role === 'admin' && (
          <MenuItem onClick={onManageUsers}>
            <ListItemIcon>
              <Glyph name="group-outline" size={18} />
            </ListItemIcon>
            {t('shell.manageUsers')}
          </MenuItem>
        )}
        <MenuItem onClick={onSignOut}>
          <ListItemIcon>
            <Glyph name="logout" size={18} />
          </ListItemIcon>
          {t('shell.signOut')}
        </MenuItem>
      </MenuList>
    </Popover>
  )
}
