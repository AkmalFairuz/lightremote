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
  const user = useAppSelector((state) => state.auth.user)

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      disableEnforceFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { className: 'account-popover' } }}
    >
      <div className="account-popover-heading">
        <Typography variant="subtitle2" noWrap>
          {user?.email}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {user?.role === 'admin' ? 'Administrator' : 'User'}
        </Typography>
      </div>
      <MenuList>
        <MenuItem onClick={onChangePassword}>
          <ListItemIcon>
            <Glyph name="lock-outline" size={18} />
          </ListItemIcon>
          Change password
        </MenuItem>
        {user?.role === 'admin' && (
          <MenuItem onClick={onManageUsers}>
            <ListItemIcon>
              <Glyph name="group-outline" size={18} />
            </ListItemIcon>
            Manage users
          </MenuItem>
        )}
        <MenuItem onClick={onSignOut}>
          <ListItemIcon>
            <Glyph name="logout" size={18} />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </MenuList>
    </Popover>
  )
}
