import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLogoutMutation } from '../../api/auth'
import { api } from '../../api/base'
import { files } from '../../api/files'
import { clearAuth } from '../../state/authSlice'
import { useAppDispatch, useAppSelector } from '../../state/hooks'
import { resetWorkspace } from '../../state/workspaceSlice'
import { Button, DialogPresence, IconButton } from '../../ui'
import { Glyph } from '../common/Glyph'
import { UsersDialog } from '../users/UsersDialog'
import { AccountPopover } from './AccountPopover'
import { ChangePasswordDialog } from './ChangePasswordDialog'
import { clearDetachedRegistry } from '../workspace/detachedTabs'
import { ViewMenu, type ViewSection } from './ViewMenu'
import { FileMenu } from './FileMenu'

interface HeaderProps {
  onToggleSidebar: () => void
  onOpenConnection: () => void
  onNewDirectConnection: () => void
}

export function Header({ onToggleSidebar, onOpenConnection, onNewDirectConnection }: HeaderProps) {
  const dispatch = useAppDispatch()
  const userId = useAppSelector((state) => state.auth.user?.id ?? '')
  const localMode = useAppSelector((state) => state.auth.localMode)
  const navigate = useNavigate()
  const [logout] = useLogoutMutation()
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null)
  const [fileAnchor, setFileAnchor] = useState<HTMLElement | null>(null)
  const [viewSection, setViewSection] = useState<ViewSection>('root')
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null)
  const [accountDialog, setAccountDialog] = useState<'password' | 'users' | null>(null)

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
    try {
      await logout().unwrap()
    } catch {
      // Clear local state even when the server has already expired the session.
    }
    dispatch(clearAuth())
    clearDetachedRegistry(userId)
    files.clearCache()
    dispatch(resetWorkspace())
    dispatch(api.util.resetApiState())
    navigate('/', { replace: true })
  }

  return (
    <header className="app-header">
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
        <nav className="header-menus" aria-label="File, view, and account">
          <Button
            aria-label="Open file actions"
            aria-haspopup="menu"
            aria-expanded={Boolean(fileAnchor)}
            onClick={(event) => {
              setViewAnchor(null)
              setAccountAnchor(null)
              setFileAnchor(event.currentTarget)
            }}
            endIcon={<Glyph name="keyboard-arrow-down" size={17} />}
          >
            File
          </Button>
          <Button
            aria-label="Open view settings"
            aria-haspopup="menu"
            aria-expanded={Boolean(viewAnchor)}
            onClick={(event) => {
              setFileAnchor(null)
              setAccountAnchor(null)
              setViewSection('root')
              setViewAnchor(event.currentTarget)
            }}
            endIcon={<Glyph name="keyboard-arrow-down" size={17} />}
          >
            View
          </Button>
          {!localMode && (
            <Button
              aria-label="Open account"
              aria-haspopup="menu"
              aria-expanded={Boolean(accountAnchor)}
              onClick={(event) => {
                setFileAnchor(null)
                setViewAnchor(null)
                setViewSection('root')
                setAccountAnchor(event.currentTarget)
              }}
              endIcon={<Glyph name="keyboard-arrow-down" size={17} />}
            >
              Account
            </Button>
          )}
        </nav>
      </div>
      <FileMenu
        anchorEl={fileAnchor}
        onClose={() => setFileAnchor(null)}
        onOpenConnection={() => {
          setFileAnchor(null)
          onOpenConnection()
        }}
        onNewDirectConnection={() => {
          setFileAnchor(null)
          onNewDirectConnection()
        }}
      />
      <ViewMenu
        anchorEl={viewAnchor}
        section={viewSection}
        onSection={setViewSection}
        onClose={() => setViewAnchor(null)}
      />
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
    </header>
  )
}
