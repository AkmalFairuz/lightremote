import type { WorkspaceTab } from '../../state/workspaceSlice'

export const detachedHeartbeatMs = 1000
export const detachedAcceptedTimeoutMs = 30_000
export const detachedPendingTimeoutMs = 60_000

export type DetachedMessage =
  | { type: 'ready' | 'accepted' | 'released'; transferId: string }
  | { type: 'heartbeat'; transferId: string; tab?: WorkspaceTab }
  | { type: 'transfer'; transferId: string; tab: WorkspaceTab }

/** Names the same-origin channel shared by one user's browser windows. */
export function detachedChannel(userId: string): string {
  return `lightremote.detached.${userId}`
}

/** Forgets detached tabs after the backend invalidates their sessions. */
export function clearDetachedRegistry(userId: string): void {
  sessionStorage.removeItem(`lightremote.detached.registry.${userId}`)
}

/** Keeps only the fields needed to recreate a detached tab. */
export function transferableTab(tab: WorkspaceTab): WorkspaceTab {
  if (tab.kind === 'vnc') {
    return { ...tab, sessionId: undefined, status: 'connecting', error: undefined }
  }
  if (tab.status !== 'ready' || tab.kind === 'sftp' || tab.kind === 'ftp') {
    return { ...tab }
  }
  return { ...tab, status: 'connecting', error: undefined }
}
