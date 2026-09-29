import { useState, type DragEvent } from 'react'
import { classNames } from '../../utils/classNames'
import { IconButton, Tooltip } from '../../ui'
import type { TabMove, WorkspaceTab } from '../../state/workspaceSlice'
import { Glyph } from '../common/Glyph'

interface TabStripProps {
  tabs: WorkspaceTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onReorder: (move: TabMove) => void
  onClose?: (id: string) => void
  onDetach?: (id: string) => void
}

/** Shows all open tabs and supports ordering and detachment. */
export function TabStrip({
  tabs,
  activeId,
  onActivate,
  onReorder,
  onClose,
  onDetach,
}: TabStripProps) {
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: TabMove['edge'] } | null>(null)

  function targetEdge(event: DragEvent<HTMLDivElement>): TabMove['edge'] {
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
  }

  return (
    <div className="tab-strip" role="tablist" aria-label="Remote workspaces">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={classNames(
            'tab-item',
            activeId === tab.id && 'tab-active',
            dropTarget?.id === tab.id && `tab-drop-${dropTarget.edge}`,
          )}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-lightremote-tab', tab.id)
            event.dataTransfer.setData('text/plain', tab.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('application/x-lightremote-tab')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropTarget({ id: tab.id, edge: targetEdge(event) })
          }}
          onDrop={(event) => {
            event.preventDefault()
            const sourceId = event.dataTransfer.getData('application/x-lightremote-tab')
            if (sourceId) onReorder({ sourceId, targetId: tab.id, edge: targetEdge(event) })
            setDropTarget(null)
          }}
          onDragEnd={() => setDropTarget(null)}
        >
          <button
            role="tab"
            aria-selected={activeId === tab.id}
            onClick={() => onActivate(tab.id)}
            className="tab-select"
          >
            <Glyph
              name={
                tab.kind === 'ssh'
                  ? 'terminal'
                  : tab.kind === 'vnc'
                    ? 'desktop-windows-outline'
                    : 'folder-outline'
              }
              size={16}
            />
            <span>{tab.name}</span>
          </button>
          {onClose && (
            <Tooltip title={`Close ${tab.name}`}>
              <IconButton aria-label={`Close ${tab.name}`} onClick={() => onClose(tab.id)}>
                <Glyph name="close" size={15} />
              </IconButton>
            </Tooltip>
          )}
          {onDetach && (
            <Tooltip title={`Detach ${tab.name}`}>
              <span>
                <IconButton
                  aria-label={`Detach ${tab.name}`}
                  disabled={tab.status === 'connecting'}
                  onClick={() => onDetach(tab.id)}
                >
                  <Glyph name="open-in-new" size={15} />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  )
}
