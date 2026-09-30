import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useCreateSessionMutation, useDeleteSessionMutation } from '../../api/sessions'
import {
  useDeleteDirectConnectionMutation,
  useInspectHostKeyMutation,
  useLazyConnectionsQuery,
  useLazyDirectConnectionQuery,
} from '../../api/resources'
import { DialogPresence } from '../../ui'
import { useAppDispatch, useAppSelector, useAppStore } from '../../state/hooks'
import {
  activateTab,
  connectionFailure,
  moveTab,
  openTab,
  setTabSession,
  setTabStatus,
  setTabPath,
  setVncFilesOpen,
  setVncFilesWidth,
  setTabZoom,
  type WorkspaceTab,
} from '../../state/workspaceSlice'
import { errorMessage, type Connection } from '../../types'
import { HostKeyDialog } from '../sidebar/HostKeyDialog'
import { isDesktop } from '../../desktop/runtime'
import { WindowControls, WindowDragRegion } from '../shell/WindowControls'
import { toggleWindowOnTitlebarDoubleClick } from '../../desktop/titlebar'
import {
  detachedChannel,
  detachedHeartbeatMs,
  transferableTab,
  type DetachedMessage,
} from './detachedTabs'
import { Workspace } from './Workspace'

/** Hosts one transferred tab in a separate browser window. */
export function DetachedWorkspacePage() {
  const { transferId = '' } = useParams()
  const userId = useAppSelector((state) => state.auth.user?.id ?? '')
  const { tabs, activeId } = useAppSelector((state) => state.workspace)
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const [createSession] = useCreateSessionMutation()
  const [deleteSession] = useDeleteSessionMutation()
  const [inspectHostKey] = useInspectHostKeyMutation()
  const [loadConnections] = useLazyConnectionsQuery()
  const [loadDirectConnection] = useLazyDirectConnectionQuery()
  const [deleteDirectConnection] = useDeleteDirectConnectionMutation()
  const [hostKeyPrompt, setHostKeyPrompt] = useState<{
    connection: Connection
    tabId: string
    fingerprint: string
  } | null>(null)
  const storageKey = `lightremote.detached.tab.${transferId}`
  const pendingKey = `lightremote.detached.pending.${transferId}`
  const pendingTab = useRef<WorkspaceTab | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const titleTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const titleName = titleTab?.name
  const titleKind = titleTab?.kind
  const directConnectionId = titleTab?.direct ? titleTab.connectionId : null

  useEffect(() => {
    if (!directConnectionId) return
    const timer = window.setInterval(
      () => {
        void loadDirectConnection(directConnectionId, false)
      },
      60 * 60 * 1000,
    )
    return () => window.clearInterval(timer)
  }, [directConnectionId, loadDirectConnection])

  function publishTabState() {
    const tab = store.getState().workspace.tabs[0]
    if (!tab) return
    sessionStorage.setItem(storageKey, JSON.stringify(tab))
    channelRef.current?.postMessage({ type: 'heartbeat', transferId, tab })
  }

  async function connectVerified(connection: Connection, tabId: string) {
    const tab = store.getState().workspace.tabs.find((item) => item.id === tabId)
    if (!tab || tab.status !== 'connecting') return
    if (connection.kind === 'sftp' || connection.kind === 'ftp') {
      dispatch(setTabStatus({ id: tabId, status: 'ready' }))
      return
    }
    try {
      const session = await createSession(connection.id).unwrap()
      const current = store.getState().workspace.tabs.find((item) => item.id === tabId)
      if (current?.status !== 'connecting') {
        void deleteSession(session.id)
        return
      }
      dispatch(setTabSession({ id: tabId, sessionId: session.id }))
    } catch (cause) {
      dispatch(connectionFailure(tab.id, tab.kind, cause))
    }
  }

  async function reconnectTab(id: string) {
    const tab = store.getState().workspace.tabs.find((item) => item.id === id)
    if (!tab || tab.status !== 'error') return
    dispatch(setTabSession({ id }))
    if (tab.sessionId) {
      try {
        await deleteSession(tab.sessionId).unwrap()
      } catch {
        // The disconnected work session may already be gone.
      }
    }
    if (store.getState().workspace.tabs.find((item) => item.id === id)?.status !== 'connecting')
      return
    try {
      const connection = tab.direct
        ? await loadDirectConnection(tab.connectionId, false).unwrap()
        : (await loadConnections(undefined, false).unwrap()).find(
            (entry) => entry.id === tab.connectionId,
          )
      if (!connection) {
        dispatch(connectionFailure(tab.id, tab.kind, 'Connection not found.'))
        return
      }
      if (connection.kind === 'ssh' || connection.kind === 'sftp') {
        const result = await inspectHostKey(connection.id).unwrap()
        if (store.getState().workspace.tabs.find((item) => item.id === id)?.status !== 'connecting')
          return
        if (connection.hostKeyFingerprint !== result.fingerprint) {
          setHostKeyPrompt({ connection, tabId: id, fingerprint: result.fingerprint })
          return
        }
      }
      await connectVerified(connection, id)
    } catch (cause) {
      dispatch(connectionFailure(tab.id, tab.kind, cause))
    }
  }

  useEffect(() => {
    const protocol = titleKind === 'ftp' ? 'FTP / FTPS' : titleKind?.toUpperCase()
    document.title = titleName ? `${titleName} · ${protocol} — LightRemote` : 'LightRemote'
    return () => {
      document.title = 'LightRemote'
    }
  }, [titleKind, titleName])

  useEffect(() => {
    if (!userId || !transferId) return
    const channel = new BroadcastChannel(detachedChannel(userId))
    channelRef.current = channel
    let disposed = false

    async function connectVnc(tab: WorkspaceTab) {
      try {
        const session = await createSession(tab.connectionId).unwrap()
        if (disposed || !store.getState().workspace.tabs.some((item) => item.id === tab.id)) {
          void deleteSession(session.id)
          return
        }
        const next = { ...tab, sessionId: session.id, status: 'connecting' as const }
        dispatch(setTabSession({ id: tab.id, sessionId: session.id }))
        sessionStorage.setItem(storageKey, JSON.stringify(next))
        channel.postMessage({ type: 'heartbeat', transferId, tab: next })
      } catch (cause) {
        if (!disposed)
          dispatch(setTabStatus({ id: tab.id, status: 'error', error: errorMessage(cause) }))
      }
    }

    const saved = sessionStorage.getItem(storageKey)
    let needsTransfer = true
    if (saved) {
      try {
        const savedTab = JSON.parse(saved) as WorkspaceTab
        if (savedTab.direct) {
          sessionStorage.removeItem(storageKey)
          sessionStorage.removeItem(pendingKey)
          void deleteDirectConnection(savedTab.connectionId)
          channel.postMessage({ type: 'closed', transferId })
          needsTransfer = false
        } else if (sessionStorage.getItem(pendingKey)) pendingTab.current = savedTab
        else {
          needsTransfer = false
          if (savedTab.kind === 'vnc') {
            const tab = transferableTab(savedTab)
            dispatch(openTab(tab))
            sessionStorage.setItem(storageKey, JSON.stringify(tab))
            void (async () => {
              if (savedTab.sessionId) {
                try {
                  await deleteSession(savedTab.sessionId).unwrap()
                } catch {
                  // The previous VNC work session may already be closed.
                }
              }
              if (!disposed) await connectVnc(tab)
            })()
          } else {
            dispatch(openTab(savedTab))
          }
        }
      } catch {
        sessionStorage.removeItem(storageKey)
        sessionStorage.removeItem(pendingKey)
      }
    }
    channel.onmessage = (event: MessageEvent<DetachedMessage>) => {
      const message = event.data
      if (message.transferId !== transferId) return
      if (message.type === 'transfer') {
        pendingTab.current = message.tab
        sessionStorage.setItem(storageKey, JSON.stringify(message.tab))
        sessionStorage.setItem(pendingKey, '1')
        channel.postMessage({ type: 'accepted', transferId })
      } else if (message.type === 'released' && pendingTab.current) {
        const tab = pendingTab.current
        pendingTab.current = null
        sessionStorage.removeItem(pendingKey)
        dispatch(openTab(tab))
        if (tab.kind === 'vnc') void connectVnc(tab)
      }
    }
    if (needsTransfer) channel.postMessage({ type: 'ready', transferId })
    const heartbeat = window.setInterval(() => {
      const tab = store.getState().workspace.tabs[0]
      if (tab) sessionStorage.setItem(storageKey, JSON.stringify(tab))
      channel.postMessage({
        type: 'heartbeat',
        transferId,
        tab,
      })
    }, detachedHeartbeatMs)
    return () => {
      disposed = true
      window.clearInterval(heartbeat)
      channel.close()
      channelRef.current = null
    }
  }, [
    createSession,
    deleteDirectConnection,
    deleteSession,
    dispatch,
    pendingKey,
    storageKey,
    store,
    transferId,
    userId,
  ])

  return (
    <div
      className={isDesktop ? 'detached-workspace desktop-detached-workspace' : 'detached-workspace'}
    >
      {isDesktop && (
        <header
          className="app-header detached-app-header"
          onDoubleClick={toggleWindowOnTitlebarDoubleClick}
        >
          <WindowDragRegion title={titleName ? `${titleName} — LightRemote` : 'LightRemote'} />
          <WindowControls />
        </header>
      )}
      <Workspace
        tabs={tabs}
        activeId={activeId}
        visible
        showTabStrip={false}
        onActivate={(id) => dispatch(activateTab(id))}
        onReorder={(move) => dispatch(moveTab(move))}
        onZoom={(id, zoom) => {
          dispatch(setTabZoom({ id, zoom }))
          publishTabState()
        }}
        onStatus={(id, status, error) => dispatch(setTabStatus({ id, status, error }))}
        onReconnect={(id) => void reconnectTab(id)}
        onFilePath={(id, path) => {
          dispatch(setTabPath({ id, path }))
          publishTabState()
        }}
        onVncFilesOpen={(id, open) => {
          dispatch(setVncFilesOpen({ id, open }))
          publishTabState()
        }}
        onVncFilesWidth={(id, width) => {
          dispatch(setVncFilesWidth({ id, width }))
          publishTabState()
        }}
      />
      <DialogPresence>
        {hostKeyPrompt && (
          <HostKeyDialog
            connection={hostKeyPrompt.connection}
            initialObserved={hostKeyPrompt.fingerprint}
            onClose={() => {
              const tab = store
                .getState()
                .workspace.tabs.find((item) => item.id === hostKeyPrompt.tabId)
              if (tab?.status === 'connecting')
                dispatch(connectionFailure(tab.id, tab.kind, 'SSH host key was not approved.'))
              setHostKeyPrompt(null)
            }}
            onApproved={async () => {
              await connectVerified(hostKeyPrompt.connection, hostKeyPrompt.tabId)
              setHostKeyPrompt(null)
            }}
          />
        )}
      </DialogPresence>
    </div>
  )
}
