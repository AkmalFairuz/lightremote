import { t } from '../../i18n'
import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { openDetachedWindow } from '../../desktop/actions'
import { isDesktop } from '../../desktop/viewerSocket'
import { desktopRuntime } from '../../desktop/runtime'
import { useCreateSessionMutation, useDeleteSessionMutation } from '../../api/sessions'
import { useDeleteDirectConnectionMutation } from '../../api/resources'
import { useAppDispatch, useAppStore } from '../../state/hooks'
import {
  closeTab,
  openTab,
  setTabSession,
  setTabStatus,
  type WorkspaceTab,
} from '../../state/workspaceSlice'
import { errorMessage } from '../../types'
import {
  detachedAcceptedTimeoutMs,
  detachedChannel,
  detachedHeartbeatMs,
  detachedPendingTimeoutMs,
  transferableTab,
  type DetachedMessage,
} from './detachedTabs'

const detachedWindowFeatures = 'popup,width=1100,height=750'

interface DetachedEntry {
  tab: WorkspaceTab
  window: Window | null
  accepted: boolean
  lastSeen: number
}

/** Moves tabs between the main workspace and windows from the same browser group. */
export function useDetachedTabs(userId: string, onNotice: (message: string) => void) {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const [createSession] = useCreateSessionMutation()
  const [deleteSession] = useDeleteSessionMutation()
  const [deleteDirectConnection] = useDeleteDirectConnectionMutation()
  const entries = useRef(new Map<string, DetachedEntry>())
  const storageKey = `lightremote.detached.registry.${userId}`

  const persist = useCallback(() => {
    const values = Array.from(entries.current, ([id, entry]) => ({
      id,
      tab: entry.tab,
      accepted: entry.accepted,
    }))
    sessionStorage.setItem(storageKey, JSON.stringify(values))
  }, [storageKey])

  const restore = useCallback(
    async (id: string) => {
      const entry = entries.current.get(id)
      if (!entry) return
      entries.current.delete(id)
      persist()
      if (!entry.accepted) return
      if (store.getState().workspace.tabs.some((tab) => tab.id === entry.tab.id)) return
      const tab = transferableTab(entry.tab)
      dispatch(openTab(tab))
      if (tab.kind !== 'vnc') return
      if (entry.tab.sessionId) {
        try {
          await deleteSession(entry.tab.sessionId).unwrap()
        } catch {
          // The old viewer may already have released its work session.
        }
      }
      try {
        const session = await createSession(tab.connectionId).unwrap()
        if (!store.getState().workspace.tabs.some((item) => item.id === tab.id)) {
          void deleteSession(session.id)
          return
        }
        dispatch(setTabSession({ id: tab.id, sessionId: session.id }))
      } catch (cause) {
        dispatch(setTabStatus({ id: tab.id, status: 'error', error: errorMessage(cause) }))
      }
    },
    [createSession, deleteSession, dispatch, persist, store],
  )

  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as {
        id: string
        tab: WorkspaceTab
        accepted: boolean
      }[]
      for (const item of stored) {
        if (item.tab.direct) {
          void deleteDirectConnection(item.tab.connectionId)
          continue
        }
        entries.current.set(item.id, {
          tab: item.tab,
          accepted: item.accepted,
          window: null,
          lastSeen: Date.now(),
        })
      }
      persist()
    } catch {
      sessionStorage.removeItem(storageKey)
    }

    const current = new BroadcastChannel(detachedChannel(userId))
    const stopNativeClose = desktopRuntime
      ? desktopRuntime.Events.On('lightremote:detached-closed', (event) => {
          if (typeof event.data === 'string') void restore(event.data)
        })
      : null
    current.onmessage = async (event: MessageEvent<DetachedMessage>) => {
      const message = event.data
      const entry = entries.current.get(message.transferId)
      if (!entry) return
      if (message.type === 'closed') {
        entries.current.delete(message.transferId)
        persist()
      } else if (message.type === 'ready') {
        current.postMessage({
          type: 'transfer',
          transferId: message.transferId,
          tab: transferableTab(entry.tab),
        })
      } else if (message.type === 'accepted') {
        entry.accepted = true
        entry.lastSeen = Date.now()
        // The source tab must release its viewer before the new window opens one.
        flushSync(() => dispatch(closeTab(entry.tab.id)))
        if (entry.tab.kind === 'vnc') {
          const previousSessionId = entry.tab.sessionId
          entry.tab = transferableTab(entry.tab)
          persist()
          if (previousSessionId) {
            try {
              await deleteSession(previousSessionId).unwrap()
            } catch {
              // The old work session may have closed before the handoff.
            }
          }
        } else {
          persist()
        }
        current.postMessage({ type: 'released', transferId: message.transferId })
      } else if (message.type === 'heartbeat') {
        entry.lastSeen = Date.now()
        if (
          message.tab &&
          message.tab.id === entry.tab.id &&
          JSON.stringify(message.tab) !== JSON.stringify(entry.tab)
        ) {
          entry.tab = message.tab
          persist()
        }
      }
    }
    const timer = window.setInterval(() => {
      const now = Date.now()
      for (const [id, entry] of entries.current) {
        const timeout = entry.accepted ? detachedAcceptedTimeoutMs : detachedPendingTimeoutMs
        if (entry.window?.closed || now - entry.lastSeen > timeout) {
          void restore(id)
        }
      }
    }, detachedHeartbeatMs)
    return () => {
      window.clearInterval(timer)
      current.close()
      stopNativeClose?.()
    }
  }, [deleteDirectConnection, deleteSession, dispatch, persist, restore, storageKey, userId])

  const detach = useCallback(
    (tab: WorkspaceTab) => {
      if (tab.status === 'connecting') return
      const transferId = crypto.randomUUID()
      let popup: Window | null = null
      if (!isDesktop) {
        popup = window.open(`/detached/${transferId}`, '_blank', detachedWindowFeatures)
      }
      if (!isDesktop && !popup) {
        onNotice(t('files.theBrowserBlockedTheDetachedWindowAllowPopupsAndTryAgain'))
        return
      }
      entries.current.set(transferId, {
        tab: { ...tab },
        window: popup,
        accepted: false,
        lastSeen: Date.now(),
      })
      persist()
      if (isDesktop) {
        void openDetachedWindow(transferId).catch((cause) => {
          entries.current.delete(transferId)
          persist()
          onNotice(cause instanceof Error ? cause.message : t('files.couldNotOpenDetachedWindow'))
        })
      } else {
        popup?.focus()
      }
    },
    [onNotice, persist],
  )

  return {
    detach,
    detachedCount: () =>
      Array.from(entries.current.values()).filter((entry) => entry.accepted).length,
  }
}
