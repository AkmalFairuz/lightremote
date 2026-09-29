import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLogoutMutation } from '../../api/auth'
import { api } from '../../api/base'
import { files } from '../../api/files'
import { clearAuth } from '../../state/authSlice'
import { useAppDispatch, useAppSelector } from '../../state/hooks'
import { resetWorkspace } from '../../state/workspaceSlice'
import { Alert, Button, DialogPresence, IconButton, Snackbar } from '../../ui'
import { Glyph } from '../common/Glyph'
import { UsersDialog } from '../users/UsersDialog'
import { AccountPopover } from './AccountPopover'
import { ChangePasswordDialog } from './ChangePasswordDialog'
import { clearDetachedRegistry } from '../workspace/detachedTabs'
import { ViewMenu, type ViewSection } from './ViewMenu'
import { FileMenu, type FileSection } from './FileMenu'
import { HelpMenu } from './HelpMenu'
import type { Connection } from '../../types'
import { errorMessage } from '../../types'
import { SSHKeyManagerDialog } from '../sshkeys/SSHKeyManagerDialog'
import { WindowControls, WindowDragRegion } from './WindowControls'
import { toggleWindowOnTitlebarDoubleClick } from '../../desktop/titlebar'

interface HeaderProps {
  onToggleSidebar: () => void
  onOpenConnection: () => void
  onNewDirectConnection: () => void
  recentConnections: Connection[]
  onOpenRecentConnection: (connection: Connection) => void
}

type HeaderMenu = 'file' | 'view' | 'help' | 'account'

export function Header({
  onToggleSidebar,
  onOpenConnection,
  onNewDirectConnection,
  recentConnections,
  onOpenRecentConnection,
}: HeaderProps) {
  const dispatch = useAppDispatch()
  const userId = useAppSelector((state) => state.auth.user?.id ?? '')
  const localMode = useAppSelector((state) => state.auth.localMode)
  const navigate = useNavigate()
  const [logout] = useLogoutMutation()
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null)
  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null)
  const [fileAnchor, setFileAnchor] = useState<HTMLElement | null>(null)
  const [fileSection, setFileSection] = useState<FileSection>('root')
  const [viewSection, setViewSection] = useState<ViewSection>('root')
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null)
  const [accountDialog, setAccountDialog] = useState<'password' | 'users' | null>(null)
  const [sshKeysOpen, setSSHKeysOpen] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.repeat ||
        event.isComposing
      ) {
        return
      }
      if (event.key.toLowerCase() !== 'k') return

      // Text fields and remote viewers need their own keyboard commands.
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, [contenteditable], .terminal-view, .vnc-workspace',
          ))
      ) {
        return
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

      event.preventDefault()
      setFileAnchor(null)
      setViewAnchor(null)
      setHelpAnchor(null)
      setAccountAnchor(null)

      if (event.shiftKey) {
        onNewDirectConnection()
      } else {
        onOpenConnection()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [onNewDirectConnection, onOpenConnection])

  /** Opens an account action after closing the navbar menu. */
  function openAccountDialog(dialog: 'password' | 'users') {
    setAccountAnchor(null)
    setAccountDialog(dialog)
  }

  async function signOut() {
    setLogoutError(null)
    try {
      await logout().unwrap()
    } catch (cause) {
      setLogoutError(errorMessage(cause))
      return
    }
    dispatch(clearAuth())
    clearDetachedRegistry(userId)
    files.clearCache()
    dispatch(resetWorkspace())
    dispatch(api.util.resetApiState())
    navigate('/', { replace: true })
  }

  function toggleMenu(menu: HeaderMenu, anchor: HTMLElement) {
    const anchors = {
      file: fileAnchor,
      view: viewAnchor,
      help: helpAnchor,
      account: accountAnchor,
    }
    const nextAnchor = anchors[menu] === anchor ? null : anchor

    setFileAnchor(menu === 'file' ? nextAnchor : null)
    setViewAnchor(menu === 'view' ? nextAnchor : null)
    setHelpAnchor(menu === 'help' ? nextAnchor : null)
    setAccountAnchor(menu === 'account' ? nextAnchor : null)
    setFileSection('root')
    setViewSection('root')
  }

  return (
    <header className="app-header" onDoubleClick={toggleWindowOnTitlebarDoubleClick}>
      <div className="header-left">
        <IconButton
          aria-label="Toggle connections sidebar"
          aria-controls="connections-sidebar"
          onClick={onToggleSidebar}
        >
          <Glyph name="menu" size={16} />
        </IconButton>
        <Link to="/" className="brand-link">
          LightRemote
        </Link>
        <nav className="header-menus" aria-label="Application menus">
          <Button
            aria-label="Open file actions"
            aria-haspopup="menu"
            aria-expanded={Boolean(fileAnchor)}
            onClick={(event) => toggleMenu('file', event.currentTarget)}
            endIcon={<Glyph name="keyboard-arrow-down" size={17} />}
          >
            File
          </Button>
          <Button
            aria-label="Open view settings"
            aria-haspopup="menu"
            aria-expanded={Boolean(viewAnchor)}
            onClick={(event) => toggleMenu('view', event.currentTarget)}
            endIcon={<Glyph name="keyboard-arrow-down" size={17} />}
          >
            View
          </Button>
          <Button
            aria-label="Open help"
            aria-haspopup="menu"
            aria-expanded={Boolean(helpAnchor)}
            onClick={(event) => toggleMenu('help', event.currentTarget)}
            endIcon={<Glyph name="keyboard-arrow-down" size={17} />}
          >
            Help
          </Button>
          {!localMode && (
            <Button
              aria-label="Open account"
              aria-haspopup="menu"
              aria-expanded={Boolean(accountAnchor)}
              onClick={(event) => toggleMenu('account', event.currentTarget)}
              endIcon={<Glyph name="keyboard-arrow-down" size={17} />}
            >
              Account
            </Button>
          )}
        </nav>
      </div>
      <WindowDragRegion />
      <WindowControls />
      <FileMenu
        anchorEl={fileAnchor}
        section={fileSection}
        onSection={setFileSection}
        onClose={() => {
          setFileAnchor(null)
          setFileSection('root')
        }}
        recentConnections={recentConnections}
        onOpenRecentConnection={onOpenRecentConnection}
        onOpenConnection={() => {
          setFileAnchor(null)
          onOpenConnection()
        }}
        onNewDirectConnection={() => {
          setFileAnchor(null)
          onNewDirectConnection()
        }}
        onManageSSHKeys={() => {
          setFileAnchor(null)
          setSSHKeysOpen(true)
        }}
      />
      <ViewMenu
        anchorEl={viewAnchor}
        section={viewSection}
        onSection={setViewSection}
        onClose={() => setViewAnchor(null)}
      />
      <HelpMenu anchorEl={helpAnchor} onClose={() => setHelpAnchor(null)} />
      <DialogPresence>
        {sshKeysOpen && <SSHKeyManagerDialog onClose={() => setSSHKeysOpen(false)} />}
      </DialogPresence>
      {!localMode && (
        <>
          <AccountPopover
            anchorEl={accountAnchor}
            onClose={() => setAccountAnchor(null)}
            onChangePassword={() => openAccountDialog('password')}
            onManageUsers={() => openAccountDialog('users')}
            onSignOut={() => void signOut()}
          />
          <DialogPresence>
            {accountDialog === 'password' && (
              <ChangePasswordDialog onClose={() => setAccountDialog(null)} />
            )}
          </DialogPresence>
          <DialogPresence>
            {accountDialog === 'users' && <UsersDialog onClose={() => setAccountDialog(null)} />}
          </DialogPresence>
        </>
      )}
      <Snackbar
        open={Boolean(logoutError)}
        autoHideDuration={5500}
        onClose={() => setLogoutError(null)}
      >
        <Alert severity="error" onClose={() => setLogoutError(null)}>
          {logoutError}
        </Alert>
      </Snackbar>
    </header>
  )
}
