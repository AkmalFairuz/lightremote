import { useEffect, useState, type CSSProperties } from 'react'
import { Alert, DialogPresence, Snackbar } from '../../ui'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useCreateSessionMutation, useDeleteSessionMutation } from '../../api/sessions'
import {
  useDeleteDirectConnectionMutation,
  useInspectHostKeyMutation,
  useLazyConnectionsQuery,
  useLazyDirectConnectionQuery,
} from '../../api/resources'
import { useAppDispatch, useAppSelector, useAppStore } from '../../state/hooks'
import {
  activateTab,
  closePaneView,
  closeTab,
  connectionFailure,
  focusPane,
  moveTab,
  openTab,
  resizePaneDivider,
  setTabSession,
  setTabStatus,
  setTabPath,
  setVncFilesOpen,
  setVncFilesWidth,
  setTabZoom,
  setSidebarWidth,
  showTabInPane,
  splitTabIntoPane,
} from '../../state/workspaceSlice'
import type { PaneEdge } from '../../state/paneLayout'
import { maxOpenTabs } from '../../state/workspaceLimits'
import type { Connection } from '../../types'
import { classNames } from '../../utils/classNames'
import { Sidebar } from '../sidebar/Sidebar'
import { HostKeyDialog } from '../sidebar/HostKeyDialog'
import { ConnectionDialog } from '../sidebar/ConnectionDialog'
import { OpenConnectionDialog } from './OpenConnectionDialog'
import { Workspace } from '../workspace/Workspace'
import { useDetachedTabs } from '../workspace/useDetachedTabs'
import { Header } from './Header'

export function AppShell() {
  const dispatch = useAppDispatch()
  const appStore = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()
  const { tabs, activeId, layout, focusedPaneId, sidebarWidth } = useAppSelector(
    (state) => state.workspace,
  )
  const [createSession] = useCreateSessionMutation()
  const [deleteSession] = useDeleteSessionMutation()
  const [inspectHostKey] = useInspectHostKeyMutation()
  const [loadConnections] = useLazyConnectionsQuery()
  const [loadDirectConnection] = useLazyDirectConnectionQuery()
  const [deleteDirectConnection] = useDeleteDirectConnectionMutation()
  const [directDialogOpen, setDirectDialogOpen] = useState(false)
  const [openConnectionDialog, setOpenConnectionDialog] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const userId = useAppSelector((state) => state.auth.user?.id ?? '')
  const { detach, detachedCount } = useDetachedTabs(userId, setMessage)
  const [hostKeyPrompt, setHostKeyPrompt] = useState<{
    connection: Connection
    fingerprint: string
    tabId: string
  } | null>(null)
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const isWorkspace = location.pathname === '/'
  const directConnectionIds = tabs
    .filter((tab) => tab.direct)
    .map((tab) => tab.connectionId)
    .join(',')

  useEffect(() => {
    if (!directConnectionIds) return
    const ids = directConnectionIds.split(',')
    const timer = window.setInterval(
      () => {
        for (const id of ids) {
          void loadDirectConnection(id, false)
        }
      },
      60 * 60 * 1000,
    )
    return () => window.clearInterval(timer)
  }, [directConnectionIds, loadDirectConnection])

  function toggleSidebar() {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setMobileSidebar((open) => !open)
    } else {
      setSidebarCollapsed((collapsed) => !collapsed)
    }
  }

  function currentTab(id: string) {
    return appStore.getState().workspace.tabs.find((tab) => tab.id === id)
  }

  async function openVerifiedConnection(connection: Connection, tabId: string) {
    if (!currentTab(tabId)) return
    if (connection.kind === 'ssh' || connection.kind === 'vnc') {
      try {
        const session = await createSession(connection.id).unwrap()
        if (currentTab(tabId)?.status !== 'connecting') {
          void deleteSession(session.id)
          return
        }
        dispatch(setTabSession({ id: tabId, sessionId: session.id }))
      } catch (cause) {
        dispatch(connectionFailure(tabId, connection.kind, cause))
      }
      return
    }

    dispatch(setTabStatus({ id: tabId, status: 'ready' }))
  }

  async function connectTab(connection: Connection, tabId: string) {
    if (connection.kind === 'ssh' || connection.kind === 'sftp') {
      try {
        const result = await inspectHostKey(connection.id).unwrap()
        if (currentTab(tabId)?.status !== 'connecting') return
        if (connection.hostKeyFingerprint !== result.fingerprint) {
          setHostKeyPrompt({ connection, fingerprint: result.fingerprint, tabId })
          return
        }
      } catch (cause) {
        dispatch(connectionFailure(tabId, connection.kind, cause))
        return
      }
    }

    await openVerifiedConnection(connection, tabId)
  }

  async function reconnectTab(id: string) {
    const tab = currentTab(id)
    if (!tab || tab.status !== 'error') return
    dispatch(setTabSession({ id }))
    if (tab.sessionId) {
      try {
        await deleteSession(tab.sessionId).unwrap()
      } catch {
        // The disconnected work session may already be gone.
      }
    }
    if (currentTab(id)?.status !== 'connecting') return
    try {
      const connection = tab.direct
        ? await loadDirectConnection(tab.connectionId, false).unwrap()
        : (await loadConnections(undefined, false).unwrap()).find(
            (entry) => entry.id === tab.connectionId,
          )
      if (!connection) {
        dispatch(connectionFailure(id, tab.kind, 'Connection not found.'))
        return
      }
      if (currentTab(id)?.status === 'connecting') await connectTab(connection, id)
    } catch (cause) {
      dispatch(connectionFailure(id, tab.kind, cause))
    }
  }

  async function openConnection(connection: Connection) {
    setMobileSidebar(false)
    navigate('/')

    const currentTabs = appStore.getState().workspace.tabs
    const existing =
      connection.kind === 'sftp' || connection.kind === 'ftp'
        ? currentTabs.find((tab) => tab.id === `files-${connection.id}`)
        : currentTabs.find(
            (tab) =>
              tab.connectionId === connection.id &&
              (tab.status === 'connecting' || tab.status === 'error'),
          )
    if (existing?.status === 'connecting' || existing?.status === 'ready') {
      dispatch(activateTab(existing.id))
      return
    }
    if (existing?.status === 'error') {
      dispatch(activateTab(existing.id))
      await reconnectTab(existing.id)
      return
    }
    if (!existing && currentTabs.length + detachedCount() >= maxOpenTabs) {
      setMessage('Close a tab before opening another connection.')
      if (connection.direct) {
        void deleteDirectConnection(connection.id)
      }
      return
    }

    const tabId =
      connection.kind === 'sftp' || connection.kind === 'ftp'
        ? `files-${connection.id}`
        : `pending-${crypto.randomUUID()}`
    const tabName = connection.direct ? connection.host : connection.name
    dispatch(
      openTab({
        id: tabId,
        connectionId: connection.id,
        direct: connection.direct,
        name: tabName,
        kind: connection.kind,
        status: 'connecting',
        vncReadOnly: connection.kind === 'vnc' ? connection.vncReadOnly : undefined,
        vncFileTransfer: connection.kind === 'vnc' ? connection.vncFileTransfer : undefined,
      }),
    )

    await connectTab(connection, tabId)
  }

  function cancelHostKeyPrompt() {
    const prompt = hostKeyPrompt
    setHostKeyPrompt(null)
    if (prompt && currentTab(prompt.tabId)?.status === 'connecting') {
      dispatch(
        connectionFailure(prompt.tabId, prompt.connection.kind, 'SSH host key was not approved.'),
      )
    }
  }

  function closeWorkspaceTab(id: string) {
    const tab = tabs.find((item) => item.id === id)
    dispatch(closeTab(id))
    setHostKeyPrompt((prompt) => (prompt?.tabId === id ? null : prompt))
    if (tab?.direct) {
      void deleteDirectConnection(tab.connectionId)
    } else if (tab?.sessionId) {
      void deleteSession(tab.sessionId)
    }
  }

  function splitWorkspaceTab(tabId: string, paneId: string, edge: PaneEdge) {
    dispatch(
      splitTabIntoPane({
        tabId,
        paneId,
        edge,
        splitId: crypto.randomUUID(),
        newPaneId: crypto.randomUUID(),
      }),
    )
  }

  return (
    <div className="app-shell">
      <Header
        onToggleSidebar={toggleSidebar}
        onOpenConnection={() => setOpenConnectionDialog(true)}
        onNewDirectConnection={() => setDirectDialogOpen(true)}
      />
      <div className="shell-body">
        {mobileSidebar && (
          <button
            type="button"
            className="mobile-sidebar-backdrop"
            aria-label="Close connections sidebar"
            onClick={() => setMobileSidebar(false)}
          />
        )}
        <aside
          id="connections-sidebar"
          className={classNames(
            'sidebar',
            sidebarCollapsed && 'sidebar-collapsed',
            sidebarResizing && 'sidebar-resizing',
            mobileSidebar && 'sidebar-open',
          )}
          style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        >
          <div className="sidebar-clip">
            <Sidebar onOpenConnection={openConnection} onNotice={setMessage} />
          </div>
        </aside>
        <div
          className={`sidebar-resizer ${sidebarCollapsed ? 'sidebar-resizer-hidden' : ''}`}
          role="separator"
          aria-label="Resize connection sidebar"
          aria-orientation="vertical"
          tabIndex={sidebarCollapsed ? -1 : 0}
          onPointerDown={(event) => {
            setSidebarResizing(true)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onLostPointerCapture={() => setSidebarResizing(false)}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              dispatch(setSidebarWidth(event.clientX))
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') dispatch(setSidebarWidth(sidebarWidth - 16))
            if (event.key === 'ArrowRight') dispatch(setSidebarWidth(sidebarWidth + 16))
          }}
        />
        <main className="shell-main">
          <div className={isWorkspace ? 'workspace-route' : 'workspace-route route-hidden'}>
            <Workspace
              tabs={tabs}
              activeId={activeId}
              layout={layout}
              focusedPaneId={focusedPaneId}
              visible={isWorkspace}
              onActivate={(id) => dispatch(activateTab(id))}
              onReorder={(move) => dispatch(moveTab(move))}
              onClose={closeWorkspaceTab}
              onZoom={(id, zoom) => dispatch(setTabZoom({ id, zoom }))}
              onStatus={(id, status, error) => dispatch(setTabStatus({ id, status, error }))}
              onReconnect={(id) => void reconnectTab(id)}
              onFilePath={(id, path) => dispatch(setTabPath({ id, path }))}
              onVncFilesOpen={(id, open) => dispatch(setVncFilesOpen({ id, open }))}
              onVncFilesWidth={(id, width) => dispatch(setVncFilesWidth({ id, width }))}
              onShowInPane={(tabId, paneId) => dispatch(showTabInPane({ tabId, paneId }))}
              onSplit={splitWorkspaceTab}
              onResize={(id, ratio) => dispatch(resizePaneDivider({ id, ratio }))}
              onFocusPane={(id) => dispatch(focusPane(id))}
              onClosePane={(id) => dispatch(closePaneView(id))}
              onDetach={(id) => {
                const tab = tabs.find((item) => item.id === id)
                if (tab) detach(tab)
              }}
            />
          </div>
          {!isWorkspace && (
            <div className="settings-route">
              <Outlet />
            </div>
          )}
        </main>
      </div>
      <Snackbar open={Boolean(message)} autoHideDuration={5500} onClose={() => setMessage(null)}>
        <Alert severity="error" onClose={() => setMessage(null)}>
          {message}
        </Alert>
      </Snackbar>
      <DialogPresence>
        {openConnectionDialog && (
          <OpenConnectionDialog
            onClose={() => setOpenConnectionDialog(false)}
            onOpen={(connection) => {
              setOpenConnectionDialog(false)
              void openConnection(connection)
            }}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {directDialogOpen && (
          <ConnectionDialog
            direct
            folders={[]}
            onClose={() => setDirectDialogOpen(false)}
            onNotice={setMessage}
            onDirectCreated={(connection) => void openConnection(connection)}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {hostKeyPrompt && (
          <HostKeyDialog
            connection={hostKeyPrompt.connection}
            initialObserved={hostKeyPrompt.fingerprint}
            onClose={cancelHostKeyPrompt}
            onApproved={async () => {
              await openVerifiedConnection(hostKeyPrompt.connection, hostKeyPrompt.tabId)
              setHostKeyPrompt(null)
            }}
          />
        )}
      </DialogPresence>
    </div>
  )
}
