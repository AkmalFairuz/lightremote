import type { CSSProperties, ReactNode } from 'react'
import { CircularProgress, IconButton, TextField } from '../../ui'
import { useAppSelector } from '../../state/hooks'
import { Glyph } from '../common/Glyph'
import { WindowControls, WindowDragRegion } from './WindowControls'

/** Shows the application frame without mounting private workspace content. */
export function LockedShell({
  children,
  checkingSession = false,
}: {
  children?: ReactNode
  checkingSession?: boolean
}) {
  const sidebarWidth = useAppSelector((state) => state.workspace.sidebarWidth)

  return (
    <div className="app-shell locked-shell">
      <header className="app-header">
        <div className="header-left">
          <IconButton disabled aria-label="Toggle connections sidebar">
            <Glyph name="menu" size={16} />
          </IconButton>
          <span className="brand-link">LightRemote</span>
        </div>
        <WindowDragRegion />
        <WindowControls />
      </header>
      <div className="shell-body">
        <aside
          className="sidebar"
          style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        >
          <div className="sidebar-content">
            <div className="sidebar-toolbar">
              <div className="sidebar-filter">
                <TextField
                  placeholder="Filter"
                  aria-label="Filter folders and connections"
                  disabled
                />
              </div>
              <div className="sidebar-tools">
                <IconButton disabled aria-label="Add folder or connection">
                  <Glyph name="add" size={17} />
                </IconButton>
              </div>
            </div>
          </div>
        </aside>
        <div className="sidebar-resizer" aria-hidden="true" />
        <main className="shell-main">
          <div className="workspace workspace-no-tabs">
            <div className="workspace-content">
              <div className="workspace-empty">
                <h1>Welcome to LightRemote</h1>
              </div>
            </div>
            <div className="status-bar locked-status-bar">No active connection</div>
          </div>
        </main>
      </div>
      {checkingSession ? (
        <div className="locked-session-check" role="status" aria-label="Checking session">
          <CircularProgress size={28} />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
