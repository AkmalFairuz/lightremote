import { useT } from '../../i18n/useT'
import { LanguageSelector } from './LanguageSelector'
import type { CSSProperties, ReactNode } from 'react'
import { CircularProgress, IconButton, TextField } from '../../ui'
import { useAppSelector } from '../../state/hooks'
import { Glyph } from '../common/Glyph'
import { WindowControls, WindowDragRegion } from './WindowControls'
import { toggleWindowOnTitlebarDoubleClick } from '../../desktop/titlebar'

/** Shows the application frame without mounting private workspace content. */
export function LockedShell({
  children,
  checkingSession = false,
}: {
  children?: ReactNode
  checkingSession?: boolean
}) {
  const t = useT()

  const sidebarWidth = useAppSelector((state) => state.workspace.sidebarWidth)

  return (
    <div className="app-shell locked-shell">
      <header className="app-header" onDoubleClick={toggleWindowOnTitlebarDoubleClick}>
        <div className="header-left">
          <IconButton disabled aria-label={t('shell.toggleConnectionsSidebar')}>
            <Glyph name="menu" size={16} />
          </IconButton>
          <span className="brand-link">LightRemote</span>
        </div>
        <LanguageSelector />
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
                  placeholder={t('shell.filter')}
                  aria-label={t('shell.filterFoldersAndConnections')}
                  disabled
                />
              </div>
              <div className="sidebar-tools">
                <IconButton disabled aria-label={t('shell.addFolderOrConnection')}>
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
                <h1>{t('shell.welcomeToLightremote')}</h1>
              </div>
            </div>
            <div className="status-bar locked-status-bar">{t('shell.noActiveConnection')}</div>
          </div>
        </main>
      </div>
      {checkingSession ? (
        <div className="locked-session-check" role="status" aria-label={t('shell.checkingSession')}>
          <CircularProgress size={28} />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
