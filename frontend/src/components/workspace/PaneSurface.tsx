import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { IconButton, Tooltip } from '../../ui'
import { paneGeometry, type PaneEdge, type PaneNode, type PaneRect } from '../../state/paneLayout'
import { maxVisiblePanes } from '../../state/workspaceLimits'
import type { WorkspaceTab } from '../../state/workspaceSlice'
import { classNames } from '../../utils/classNames'
import { Glyph } from '../common/Glyph'
import { PaneView } from './PaneView'
import type { VncControls } from './vncControls'

const percent = 100
const paneEdgeFraction = 0.25
const oppositePaneEdgeFraction = 1 - paneEdgeFraction

interface PaneSurfaceProps {
  tabs: WorkspaceTab[]
  layout: PaneNode
  focusedPaneId: string
  visible: boolean
  onStatus: (id: string, status: WorkspaceTab['status'], error?: string) => void
  onReconnect: (id: string) => void
  onFilePath: (id: string, path: string) => void
  onVncFilesOpen: (id: string, open: boolean) => void
  onVncFilesWidth: (id: string, width: number) => void
  onVncControls: (id: string, controls: VncControls | null) => void
  onShowInPane: (tabId: string, paneId: string) => void
  onSplit: (tabId: string, paneId: string, edge: PaneEdge) => void
  onResize: (id: string, ratio: number) => void
  onFocusPane: (id: string) => void
  onClosePane: (id: string) => void
}

function paneStyle(rect: PaneRect): CSSProperties {
  return {
    left: `${rect.left * percent}%`,
    top: `${rect.top * percent}%`,
    width: `${rect.width * percent}%`,
    height: `${rect.height * percent}%`,
  }
}

function dropEdge(event: DragEvent<HTMLDivElement>): PaneEdge | null {
  const bounds = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - bounds.left) / bounds.width
  const y = (event.clientY - bounds.top) / bounds.height
  // Only the outer quarter of a pane creates another pane.
  if (x < paneEdgeFraction) return 'left'
  if (x > oppositePaneEdgeFraction) return 'right'
  if (y < paneEdgeFraction) return 'top'
  if (y > oppositePaneEdgeFraction) return 'bottom'
  return null
}

/** Places mounted tab viewers into up to four resizable panes. */
export function PaneSurface({
  tabs,
  layout,
  focusedPaneId,
  visible,
  onStatus,
  onReconnect,
  onFilePath,
  onVncFilesOpen,
  onVncFilesWidth,
  onVncControls,
  onShowInPane,
  onSplit,
  onResize,
  onFocusPane,
  onClosePane,
}: PaneSurfaceProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const geometry = useMemo(() => paneGeometry(layout), [layout])
  const [paneDrop, setPaneDrop] = useState<{ id: string; edge: PaneEdge | null } | null>(null)

  function acceptDrop(event: DragEvent<HTMLDivElement>, paneId: string) {
    event.preventDefault()
    const tabId = event.dataTransfer.getData('application/x-lightremote-tab')
    if (tabId) {
      const edge = dropEdge(event)
      if (edge && geometry.panes.length < maxVisiblePanes) onSplit(tabId, paneId, edge)
      else onShowInPane(tabId, paneId)
    }
    setPaneDrop(null)
  }

  function trackDrop(event: DragEvent<HTMLDivElement>, paneId: string) {
    if (!event.dataTransfer.types.includes('application/x-lightremote-tab')) return
    event.preventDefault()
    setPaneDrop({ id: paneId, edge: dropEdge(event) })
  }

  return (
    <div className="workspace-content" ref={contentRef}>
      {tabs.length === 0 && (
        <div className="workspace-empty">
          <h1>Welcome to LightRemote</h1>
        </div>
      )}
      {tabs.length > 0 &&
        geometry.panes
          .filter((pane) => !pane.tabId)
          .map((pane) => (
            <div
              key={pane.paneId}
              className={classNames(
                'workspace-empty-pane',
                paneDrop?.id === pane.paneId && `pane-drop-${paneDrop.edge ?? 'center'}`,
              )}
              style={paneStyle(pane)}
              aria-label="Drop a tab here"
              onClick={() => onFocusPane(pane.paneId)}
              onDragOver={(event) => trackDrop(event, pane.paneId)}
              onDrop={(event) => acceptDrop(event, pane.paneId)}
            >
              Welcome to LightRemote
            </div>
          ))}
      {tabs.map((tab) => {
        const pane = geometry.panes.find((entry) => entry.tabId === tab.id)
        return (
          <div
            key={tab.id}
            role="tabpanel"
            className={classNames(
              'workspace-panel',
              !pane && 'panel-hidden',
              paneDrop && paneDrop.id === pane?.paneId && `pane-drop-${paneDrop.edge ?? 'center'}`,
            )}
            style={pane ? paneStyle(pane) : undefined}
            onPointerDown={() => {
              if (pane && pane.paneId !== focusedPaneId) onFocusPane(pane.paneId)
            }}
            onDragOver={(event) => {
              if (pane) trackDrop(event, pane.paneId)
            }}
            onDrop={(event) => {
              if (pane) acceptDrop(event, pane.paneId)
            }}
          >
            <PaneView
              tab={tab}
              visible={visible && Boolean(pane)}
              focused={pane?.paneId === focusedPaneId}
              onStatus={onStatus}
              onReconnect={onReconnect}
              onFilePath={onFilePath}
              onVncFilesOpen={onVncFilesOpen}
              onVncFilesWidth={onVncFilesWidth}
              onVncControls={onVncControls}
            />
          </div>
        )
      })}
      {geometry.panes.length > 1 &&
        geometry.panes.map((pane) => (
          <Tooltip key={`close-${pane.paneId}`} title="Close pane">
            <IconButton
              className="pane-close"
              style={{
                left: `calc(${(pane.left + pane.width) * percent}% - 28px)`,
                top: `${pane.top * percent}%`,
              }}
              aria-label="Close pane"
              onClick={() => onClosePane(pane.paneId)}
            >
              <Glyph name="close" size={14} />
            </IconButton>
          </Tooltip>
        ))}
      {geometry.dividers.map((divider) => (
        <div
          key={divider.id}
          className={`pane-divider pane-divider-${divider.direction}`}
          role="separator"
          aria-label="Resize workspace panes"
          aria-orientation={divider.direction === 'row' ? 'vertical' : 'horizontal'}
          style={{
            left: `${divider.left * percent}%`,
            top: `${divider.top * percent}%`,
            width: `${divider.width * percent}%`,
            height: `${divider.height * percent}%`,
          }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !contentRef.current)
              return
            const bounds = contentRef.current.getBoundingClientRect()
            const position =
              divider.direction === 'row'
                ? (event.clientX - bounds.left) / bounds.width
                : (event.clientY - bounds.top) / bounds.height
            onResize(divider.id, (position - divider.start) / divider.extent)
          }}
        />
      ))}
    </div>
  )
}
