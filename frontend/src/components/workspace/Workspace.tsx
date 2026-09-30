import { useCallback, useState } from 'react'
import type { TabMove, WorkspaceTab } from '../../state/workspaceSlice'
import type { Connection } from '../../types'
import { TabSurface } from './TabSurface'
import { StatusBar } from './StatusBar'
import { TabStrip } from './TabStrip'
import type { VncControls } from './vncControls'

interface WorkspaceProps {
  tabs: WorkspaceTab[]
  activeId: string | null
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
  onDetach?: (id: string) => void
  showTabStrip?: boolean
}

/** Combines open tabs with the active tab's viewer and status. */
export function Workspace({
  tabs,
  activeId,
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
      <TabSurface
        tabs={tabs}
        activeId={activeId}
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
