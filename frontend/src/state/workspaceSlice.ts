import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { errorMessage, type ConnectionKind } from '../types'
import { clampZoom } from '../utils/zoom'
import {
  assignPane,
  findPane,
  paneCount,
  removePane,
  resizePane,
  splitPane,
  type PaneEdge,
  type PaneNode,
} from './paneLayout'
import {
  initialSidebarWidth,
  maxOpenTabs,
  maxSidebarWidth,
  maxVisiblePanes,
  minSidebarWidth,
} from './workspaceLimits'

export interface WorkspaceTab {
  id: string
  connectionId: string
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

export interface PaneSplit {
  tabId: string
  paneId: string
  edge: PaneEdge
  splitId: string
  newPaneId: string
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeId: string | null
  layout: PaneNode
  focusedPaneId: string
  sidebarWidth: number
}

const initialState: WorkspaceState = {
  tabs: [],
  activeId: null,
  layout: { type: 'pane', id: 'main', tabId: null },
  focusedPaneId: 'main',
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
      assignPane(state.layout, state.focusedPaneId, action.payload.id)
      state.activeId = action.payload.id
    },
    activateTab: (state, action: PayloadAction<string>) => {
      if (!state.tabs.some((tab) => tab.id === action.payload)) return
      const visible = findPane(state.layout, action.payload, true)
      if (visible) state.focusedPaneId = visible.id
      else assignPane(state.layout, state.focusedPaneId, action.payload)
      state.activeId = action.payload
    },
    showTabInPane: (state, action: PayloadAction<{ tabId: string; paneId: string }>) => {
      if (!state.tabs.some((tab) => tab.id === action.payload.tabId)) return
      if (!findPane(state.layout, action.payload.paneId)) return
      assignPane(state.layout, action.payload.paneId, action.payload.tabId)
      state.focusedPaneId = action.payload.paneId
      state.activeId = action.payload.tabId
    },
    focusPane: (state, action: PayloadAction<string>) => {
      const pane = findPane(state.layout, action.payload)
      if (!pane) return
      state.focusedPaneId = pane.id
      state.activeId = pane.tabId
    },
    splitTabIntoPane: (state, action: PayloadAction<PaneSplit>) => {
      const { tabId, paneId, edge, splitId, newPaneId } = action.payload
      if (paneCount(state.layout) >= maxVisiblePanes || !findPane(state.layout, paneId)) return
      if (!state.tabs.some((tab) => tab.id === tabId)) return
      if (findPane(state.layout, tabId, true)?.id === paneId) return
      const previous = findPane(state.layout, tabId, true)
      if (previous) previous.tabId = null
      state.layout = splitPane(state.layout, paneId, tabId, edge, splitId, newPaneId)
      state.focusedPaneId = newPaneId
      state.activeId = tabId
    },
    resizePaneDivider: (state, action: PayloadAction<{ id: string; ratio: number }>) => {
      resizePane(state.layout, action.payload.id, action.payload.ratio)
    },
    closePaneView: (state, action: PayloadAction<string>) => {
      if (paneCount(state.layout) <= 1) return
      state.layout = removePane(state.layout, action.payload)
      const focused = findPane(state.layout, state.focusedPaneId)
      if (!focused) {
        const pane = firstFilledPane(state.layout) ?? firstPane(state.layout)
        state.focusedPaneId = pane.id
        state.activeId = pane.tabId
      }
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
      const pane = findPane(state.layout, action.payload, true)
      if (pane) pane.tabId = null
      if (state.activeId === action.payload) {
        replaceFocusedTab(state)
      }
    },
    closeConnectionTabs: (state, action: PayloadAction<string>) => {
      for (const removed of state.tabs.filter((tab) => tab.connectionId === action.payload)) {
        const pane = findPane(state.layout, removed.id, true)
        if (pane) pane.tabId = null
      }
      state.tabs = state.tabs.filter((tab) => tab.connectionId !== action.payload)
      if (!state.tabs.some((tab) => tab.id === state.activeId)) replaceFocusedTab(state)
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
      if (!tab || (tab.kind !== 'ssh' && tab.kind !== 'vnc')) return
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

function firstPane(node: PaneNode): Extract<PaneNode, { type: 'pane' }> {
  return node.type === 'pane' ? node : firstPane(node.first)
}

function firstFilledPane(node: PaneNode): Extract<PaneNode, { type: 'pane' }> | null {
  if (node.type === 'pane') return node.tabId ? node : null
  return firstFilledPane(node.first) ?? firstFilledPane(node.second)
}

function replaceFocusedTab(state: WorkspaceState) {
  const hidden = [...state.tabs].reverse().find((tab) => !findPane(state.layout, tab.id, true))
  if (hidden) {
    assignPane(state.layout, state.focusedPaneId, hidden.id)
    state.activeId = hidden.id
    return
  }
  const visible = firstFilledPane(state.layout)
  state.focusedPaneId = visible?.id ?? firstPane(state.layout).id
  state.activeId = visible?.tabId ?? null
}

export const {
  openTab,
  activateTab,
  showTabInPane,
  focusPane,
  splitTabIntoPane,
  resizePaneDivider,
  closePaneView,
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

/** SSH failures clear their session ID; other tabs retain their error status. */
export function connectionFailure(id: string, kind: ConnectionKind, cause: unknown) {
  const error = errorMessage(cause)
  return kind === 'ssh'
    ? setTabSession({ id, error })
    : setTabStatus({ id, status: 'error', error })
}

export default workspaceSlice.reducer
