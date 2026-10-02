import { useT } from '../i18n/useT'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  Dialog as MuiDialog,
  DialogActions as MuiDialogActions,
  DialogContent as MuiDialogContent,
  DialogTitle as MuiDialogTitle,
  IconButton as MuiIconButton,
  ListItemIcon as MuiListItemIcon,
  Menu as MuiMenu,
  MenuItem as MuiMenuItem,
  Snackbar as MuiSnackbar,
} from '@mui/material'
import { LocalIcon } from './localIcons'
import type {
  DialogActionsProps,
  DialogContentProps,
  DialogTitleProps,
  MenuItemProps,
} from '@mui/material'

interface DialogProps {
  open: boolean
  onClose: () => void
  className?: string
  'aria-labelledby'?: string
  fullWidth?: boolean
  maxWidth?: 'xs' | 'sm'
  children: ReactNode
}

const DialogPresenceContext = createContext<{
  open: boolean
  onExited: () => void
} | null>(null)
const DialogCloseContext = createContext<(() => void) | null>(null)

/** Keeps a conditional dialog mounted until its Material UI exit transition finishes. */
export function DialogPresence({ children }: { children: ReactNode }) {
  const active = Boolean(children)
  const [lastChildren, setLastChildren] = useState<ReactNode>(null)

  if (active && lastChildren !== children) {
    setLastChildren(children)
  }

  const displayed = active ? children : lastChildren
  if (!displayed) return null

  return (
    <DialogPresenceContext.Provider value={{ open: active, onExited: () => setLastChildren(null) }}>
      {displayed}
    </DialogPresenceContext.Provider>
  )
}

/** Displays a Material UI modal for forms and confirmations. */
export function Dialog({ onClose, ...props }: DialogProps) {
  const presence = useContext(DialogPresenceContext)
  return (
    <DialogCloseContext.Provider value={onClose}>
      <MuiDialog
        {...props}
        open={props.open && (presence?.open ?? true)}
        onClose={onClose}
        slotProps={{
          paper: { className: 'ui-dialog' },
          transition: { onExited: presence?.onExited },
        }}
      />
    </DialogCloseContext.Provider>
  )
}

/** Renders a dialog heading. */
export function DialogTitle({ children, className = '', ...props }: DialogTitleProps) {
  const t = useT()

  const onClose = useContext(DialogCloseContext)

  return (
    <MuiDialogTitle className={`ui-dialog-title ${className}`} {...props}>
      <span className="ui-dialog-title-text">{children}</span>
      {onClose && (
        <MuiIconButton
          type="button"
          size="small"
          aria-label={t('common.closeDialog')}
          onClick={onClose}
        >
          <LocalIcon name="close" size={20} />
        </MuiIconButton>
      )}
    </MuiDialogTitle>
  )
}

/** Renders scrollable dialog content. */
export function DialogContent({ className = '', ...props }: DialogContentProps) {
  return <MuiDialogContent className={`ui-dialog-content ${className}`} {...props} />
}

/** Renders dialog action buttons. */
export function DialogActions(props: DialogActionsProps) {
  return <MuiDialogActions {...props} />
}

interface MenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onClosed: () => void
  children: ReactNode
}

const menuExitDurationMs = 180

/** Opens actions next to their trigger and clears the anchor after closing. */
export function Menu({ anchorEl, open, onClose, onClosed, children }: MenuProps) {
  useEffect(() => {
    if (open || !anchorEl) return
    const timer = window.setTimeout(onClosed, menuExitDurationMs)
    return () => window.clearTimeout(timer)
  }, [anchorEl, onClosed, open])

  return (
    <MuiMenu anchorEl={anchorEl} open={open} onClose={onClose}>
      {children}
    </MuiMenu>
  )
}

/** Renders an action or a choice inside a Material UI select. */
export function MenuItem(props: MenuItemProps) {
  return <MuiMenuItem {...props} />
}

/** Aligns an icon inside a menu item. */
export function ListItemIcon({ children }: { children: ReactNode }) {
  return <MuiListItemIcon>{children}</MuiListItemIcon>
}

interface SnackbarProps {
  open: boolean
  autoHideDuration?: number
  onClose: () => void
  children: ReactNode
}

/** Displays a temporary application notice. */
export function Snackbar({ onClose, children, ...props }: SnackbarProps) {
  return (
    <MuiSnackbar
      {...props}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      <div>{children}</div>
    </MuiSnackbar>
  )
}
