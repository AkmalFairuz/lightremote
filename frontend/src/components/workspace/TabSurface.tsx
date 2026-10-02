import { useT } from '../../i18n/useT'
import { useEffect, useRef } from 'react'
import type { WorkspaceTab } from '../../state/workspaceSlice'
import type { Connection } from '../../types'
import { classNames } from '../../utils/classNames'
import { clampZoom, defaultZoom, zoomStep } from '../../utils/zoom'
import { isDesktop } from '../../desktop/runtime'
import {
  newDirectConnectionShortcut,
  openConnectionShortcut,
} from '../../utils/connectionShortcuts'
import { TabView } from './TabView'
import type { VncControls } from './vncControls'

interface TabSurfaceProps {
  tabs: WorkspaceTab[]
  activeId: string | null
  visible: boolean
  recentConnections: Connection[]
  onOpenConnection?: (connection: Connection) => void
  onZoom: (id: string, zoom: number) => void
  onStatus: (id: string, status: WorkspaceTab['status'], error?: string) => void
  onReconnect: (id: string) => void
  onFilePath: (id: string, path: string) => void
  onVncFilesOpen: (id: string, open: boolean) => void
  onVncFilesWidth: (id: string, width: number) => void
  onVncControls: (id: string, controls: VncControls | null) => void
}

/** Shows one tab at full size while preserving the other tabs' viewers. */
export function TabSurface({
  tabs,
  activeId,
  visible,
  recentConnections,
  onOpenConnection,
  onZoom,
  onStatus,
  onReconnect,
  onFilePath,
  onVncFilesOpen,
  onVncFilesWidth,
  onVncControls,
}: TabSurfaceProps) {
  const t = useT()

  const contentRef = useRef<HTMLDivElement>(null)
  const zoomValues = useRef(new Map<string, number>())

  useEffect(() => {
    zoomValues.current = new Map(tabs.map((tab) => [tab.id, tab.zoom ?? defaultZoom]))
  }, [tabs])

  useEffect(() => {
    if (!isDesktop || !visible) return
    const content = contentRef.current
    if (!content) return

    function zoomWithWheel(event: WheelEvent) {
      if (!event.ctrlKey || event.deltaY === 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest('.terminal-view, .vnc-viewport')) return
      const panel = target.closest<HTMLElement>('.workspace-panel[data-tab-id]')
      if (!panel || !content?.contains(panel)) return

      const tab = tabs.find((item) => item.id === panel.dataset.tabId)
      if (!tab || (tab.kind !== 'ssh' && tab.kind !== 'telnet' && tab.kind !== 'vnc')) return

      event.preventDefault()
      event.stopPropagation()
      const currentZoom = zoomValues.current.get(tab.id) ?? tab.zoom ?? defaultZoom
      const direction = event.deltaY < 0 ? 1 : -1
      const nextZoom = clampZoom(tab.kind, currentZoom + direction * zoomStep)
      if (nextZoom === currentZoom) return

      if (tab.kind === 'vnc') {
        target.closest('.vnc-viewport')?.dispatchEvent(
          new CustomEvent('vnc-zoom-anchor', {
            detail: { clientX: event.clientX, clientY: event.clientY },
          }),
        )
      }
      zoomValues.current.set(tab.id, nextZoom)
      onZoom(tab.id, nextZoom)
    }

    content.addEventListener('wheel', zoomWithWheel, { capture: true, passive: false })
    return () => content.removeEventListener('wheel', zoomWithWheel, true)
  }, [onZoom, tabs, visible])

  return (
    <div className="workspace-content" ref={contentRef}>
      {tabs.length === 0 && (
        <div className="workspace-empty workspace-empty-with-content">
          <div className="workspace-empty-content">
            <h1>{t('shell.welcomeToLightremote')}</h1>
            <div
              className="workspace-shortcuts"
              aria-label={t('files.connectionKeyboardShortcuts')}
            >
              <span>
                <kbd>{openConnectionShortcut}</kbd> {t('shell.openConnection')}
              </span>
              <span>
                <kbd>{newDirectConnectionShortcut}</kbd> {t('shell.newDirectConnection')}
              </span>
            </div>
            {onOpenConnection && recentConnections.length > 0 && (
              <section className="workspace-recent" aria-labelledby="workspace-recent-title">
                <h2 id="workspace-recent-title">{t('shell.recentConnections')}</h2>
                <div className="workspace-recent-links">
                  {recentConnections.map((connection) => (
                    <button
                      key={connection.id}
                      type="button"
                      className="workspace-recent-link"
                      title={`${connection.name} · ${connection.kind.toUpperCase()} · ${connection.host}`}
                      onClick={() => onOpenConnection(connection)}
                    >
                      {connection.name} · {connection.kind.toUpperCase()}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <div
            key={tab.id}
            role="tabpanel"
            data-tab-id={tab.id}
            className={classNames('workspace-panel', !active && 'panel-hidden')}
            aria-hidden={!active}
          >
            <TabView
              tab={tab}
              visible={visible && active}
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
    </div>
  )
}
