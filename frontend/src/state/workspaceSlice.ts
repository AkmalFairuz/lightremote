import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { errorMessage, type ConnectionKind } from '../types'
import { clampZoom } from '../utils/zoom'
import {
  initialSidebarWidth,
  maxOpenTabs,
  maxSidebarWidth,
  minSidebarWidth,
} from './workspaceLimits'

export interface WorkspaceTab {
  id: string
  connectionId: string
  direct: boolean
  name: string
  kind: ConnectionKind
  status: 'connecting' | 'ready' | 'error'
  sessionId?: string
  error?: string
  zoom?: number
  path?: string
  vncFilesOpen?: boolean
  vncFilesWidth?: number
  vncReadOnly?: boolean
  vncFileTransfer?: boolean
}

export interface TabMove {
  sourceId: string
  targetId: string
  edge: 'before' | 'after'
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeId: string | null
  sidebarWidth: number
}

const initialState: WorkspaceState = {
  tabs: [],
  activeId: null,
  sidebarWidth: initialSidebarWidth,
}

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState,
  reducers: {
    openTab: (state, action: PayloadAction<WorkspaceTab>) => {
      const existing = state.tabs.find((tab) => tab.id === action.payload.id)
      if (!existing && state.tabs.length >= maxOpenTabs) return
      if (!existing) state.tabs.push(action.payload)
      state.activeId = action.payload.id
    },
    activateTab: (state, action: PayloadAction<string>) => {
      if (!state.tabs.some((tab) => tab.id === action.payload)) return
      state.activeId = action.payload
    },
    setTabSession: (
      state,
      action: PayloadAction<{ id: string; sessionId?: string; error?: string }>,
    ) => {
      const tab = state.tabs.find((item) => item.id === action.payload.id)
      if (!tab) return
      tab.sessionId = action.payload.sessionId
      tab.error = action.payload.error
      tab.status = action.payload.error ? 'error' : 'connecting'
    },
    setTabStatus: (
      state,
      action: PayloadAction<{ id: string; status: WorkspaceTab['status']; error?: string }>,
    ) => {
      const tab = state.tabs.find((item) => item.id === action.payload.id)
      if (!tab) return
      tab.status = action.payload.status
      tab.error = action.payload.error
    },
    moveTab: (state, action: PayloadAction<TabMove>) => {
      const { sourceId, targetId, edge } = action.payload
      if (sourceId === targetId) return
      const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceId)
      if (sourceIndex < 0) return
      const [tab] = state.tabs.splice(sourceIndex, 1)
      const targetIndex = state.tabs.findIndex((item) => item.id === targetId)
      if (targetIndex < 0) {
        state.tabs.splice(sourceIndex, 0, tab)
        return
      }
      state.tabs.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, tab)
    },
    closeTab: (state, action: PayloadAction<string>) => {
      state.tabs = state.tabs.filter((tab) => tab.id !== action.payload)
      if (state.activeId === action.payload) {
        state.activeId = state.tabs.at(-1)?.id ?? null
      }
    },
    closeConnectionTabs: (state, action: PayloadAction<string>) => {
      state.tabs = state.tabs.filter((tab) => tab.connectionId !== action.payload)
      if (!state.tabs.some((tab) => tab.id === state.activeId)) {
        state.activeId = state.tabs.at(-1)?.id ?? null
      }
    },
    renameConnectionTabs: (
      state,
      action: PayloadAction<{ connectionId: string; name: string }>,
    ) => {
      for (const tab of state.tabs) {
        if (tab.connectionId === action.payload.connectionId) tab.name = action.payload.name
      }
    },
    setTabZoom: (state, action: PayloadAction<{ id: string; zoom: number }>) => {
      const tab = state.tabs.find((item) => item.id === action.payload.id)
      if (!tab || (tab.kind !== 'ssh' && tab.kind !== 'telnet' && tab.kind !== 'vnc')) return
      tab.zoom = clampZoom(tab.kind, action.payload.zoom)
    },
    setTabPath: (state, action: PayloadAction<{ id: string; path: string }>) => {
      const tab = state.tabs.find((item) => item.id === action.payload.id)
      if (tab && (tab.kind === 'sftp' || tab.kind === 'ftp' || tab.kind === 'vnc')) {
        tab.path = action.payload.path
      }
    },
    setVncFilesOpen: (state, action: PayloadAction<{ id: string; open: boolean }>) => {
      const tab = state.tabs.find((item) => item.id === action.payload.id)
      if (tab?.kind === 'vnc') tab.vncFilesOpen = action.payload.open
    },
    setVncFilesWidth: (state, action: PayloadAction<{ id: string; width: number }>) => {
      const tab = state.tabs.find((item) => item.id === action.payload.id)
      if (tab?.kind === 'vnc') tab.vncFilesWidth = action.payload.width
    },
    setSidebarWidth: (state, action: PayloadAction<number>) => {
      state.sidebarWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, action.payload))
    },
    resetWorkspace: () => initialState,
  },
})

export const {
  openTab,
  activateTab,
  setTabSession,
  setTabStatus,
  moveTab,
  closeTab,
  closeConnectionTabs,
  renameConnectionTabs,
  setTabZoom,
  setTabPath,
  setVncFilesOpen,
  setVncFilesWidth,
  setSidebarWidth,
  resetWorkspace,
} = workspaceSlice.actions

/** Terminal failures clear their session ID; other tabs retain their error status. */
export function connectionFailure(id: string, kind: ConnectionKind, cause: unknown) {
  const error = errorMessage(cause)
  return kind === 'ssh' || kind === 'telnet'
    ? setTabSession({ id, error })
    : setTabStatus({ id, status: 'error', error })
}

export default workspaceSlice.reducer
