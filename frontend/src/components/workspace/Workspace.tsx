import { useCallback, useState } from 'react'
import type { PaneEdge, PaneNode } from '../../state/paneLayout'
import type { TabMove, WorkspaceTab } from '../../state/workspaceSlice'
import type { Connection } from '../../types'
import { PaneSurface } from './PaneSurface'
import { StatusBar } from './StatusBar'
import { TabStrip } from './TabStrip'
import type { VncControls } from './vncControls'

interface WorkspaceProps {
  tabs: WorkspaceTab[]
  activeId: string | null
  layout: PaneNode
  focusedPaneId: string
  visible: boolean
  recentConnections?: Connection[]
  onOpenConnection?: (connection: Connection) => void
  onActivate: (id: string) => void
  onReorder: (move: TabMove) => void
  onClose?: (id: string) => void
  onZoom: (id: string, zoom: number) => void
  onStatus: (id: string, status: WorkspaceTab['status'], error?: string) => void
  onReconnect: (id: string) => void
  onFilePath: (id: string, path: string) => void
  onVncFilesOpen: (id: string, open: boolean) => void
  onVncFilesWidth: (id: string, width: number) => void
  onShowInPane: (tabId: string, paneId: string) => void
  onSplit: (tabId: string, paneId: string, edge: PaneEdge) => void
  onResize: (id: string, ratio: number) => void
  onFocusPane: (id: string) => void
  onClosePane: (id: string) => void
  onDetach?: (id: string) => void
  showTabStrip?: boolean
}

/** Combines global tabs, visible panes, and the focused pane's status. */
export function Workspace({
  tabs,
  activeId,
  layout,
  focusedPaneId,
  visible,
  recentConnections = [],
  onOpenConnection,
  onActivate,
  onReorder,
  onClose,
  onZoom,
  onStatus,
  onReconnect,
  onFilePath,
  onVncFilesOpen,
  onVncFilesWidth,
  onShowInPane,
  onSplit,
  onResize,
  onFocusPane,
  onClosePane,
  onDetach,
  showTabStrip = true,
}: WorkspaceProps) {
  const active = tabs.find((tab) => tab.id === activeId)
  const hasTabStrip = showTabStrip && tabs.length > 0
  const [vncControls, setVncControls] = useState<Record<string, VncControls>>({})
  const onVncControls = useCallback((id: string, controls: VncControls | null) => {
    setVncControls((current) => {
      if (controls) return { ...current, [id]: controls }
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  return (
    <div className={`workspace ${hasTabStrip ? '' : 'workspace-no-tabs'}`}>
      {hasTabStrip && (
        <TabStrip
          tabs={tabs}
          activeId={activeId}
          onActivate={onActivate}
          onReorder={onReorder}
          onClose={onClose}
          onDetach={onDetach}
        />
      )}
      <PaneSurface
        tabs={tabs}
        layout={layout}
        focusedPaneId={focusedPaneId}
        visible={visible}
        recentConnections={recentConnections}
        onOpenConnection={onOpenConnection}
        onZoom={onZoom}
        onStatus={onStatus}
        onReconnect={onReconnect}
        onFilePath={onFilePath}
        onVncFilesOpen={onVncFilesOpen}
        onVncFilesWidth={onVncFilesWidth}
        onVncControls={onVncControls}
        onShowInPane={onShowInPane}
        onSplit={onSplit}
        onResize={onResize}
        onFocusPane={onFocusPane}
        onClosePane={onClosePane}
      />
      <StatusBar
        tab={active}
        vncControls={active ? vncControls[active.id] : undefined}
        onZoom={(zoom) => {
          if (active) onZoom(active.id, zoom)
        }}
      />
    </div>
  )
}
