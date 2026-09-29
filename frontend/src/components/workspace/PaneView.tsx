import { lazy, Suspense } from 'react'
import type { WorkspaceTab } from '../../state/workspaceSlice'
import { defaultZoom } from '../../utils/zoom'
import { ConnectionStatePanel } from './ConnectionStatePanel'
import { FileManager } from './FileManager'
import type { VncControls } from './vncControls'

const SshTerminal = lazy(() =>
  import('./SshTerminal').then((module) => ({ default: module.SshTerminal })),
)
const VncCanvas = lazy(() =>
  import('./VncCanvas').then((module) => ({ default: module.VncCanvas })),
)

interface PaneViewProps {
  tab: WorkspaceTab
  visible: boolean
  focused: boolean
  onStatus: (id: string, status: WorkspaceTab['status'], error?: string) => void
  onReconnect: (id: string) => void
  onFilePath: (id: string, path: string) => void
  onVncFilesOpen: (id: string, open: boolean) => void
  onVncFilesWidth: (id: string, width: number) => void
  onVncControls: (id: string, controls: VncControls | null) => void
}

/** Keeps a tab's remote viewer mounted while another tab is shown. */
export function PaneView({
  tab,
  visible,
  focused,
  onStatus,
  onReconnect,
  onFilePath,
  onVncFilesOpen,
  onVncFilesWidth,
  onVncControls,
}: PaneViewProps) {
  return (
    <>
      {tab.kind === 'ssh' && tab.sessionId && tab.status !== 'error' && (
        <Suspense fallback={<ConnectionStatePanel state="connecting" />}>
          <SshTerminal
            sessionId={tab.sessionId}
            visible={visible}
            active={visible && focused}
            zoom={tab.zoom ?? defaultZoom}
            onConnected={() => onStatus(tab.id, 'ready')}
            onConnectionError={(error) => onStatus(tab.id, 'error', error)}
          />
        </Suspense>
      )}
      {tab.kind === 'vnc' && tab.sessionId && tab.status !== 'error' && (
        <Suspense fallback={<ConnectionStatePanel state="connecting" />}>
          <VncCanvas
            tabId={tab.id}
            tabName={tab.name}
            sessionId={tab.sessionId}
            connectionId={tab.connectionId}
            readOnly={tab.vncReadOnly ?? false}
            fileTransfer={tab.vncFileTransfer !== false}
            active={visible}
            zoom={tab.zoom ?? defaultZoom}
            filePath={tab.path}
            filesOpen={tab.vncFilesOpen ?? false}
            filesWidth={tab.vncFilesWidth ?? null}
            onFilePath={onFilePath}
            onFilesOpen={onVncFilesOpen}
            onFilesWidth={onVncFilesWidth}
            onConnected={() => onStatus(tab.id, 'ready')}
            onConnectionError={(error) => onStatus(tab.id, 'error', error)}
            onControls={onVncControls}
          />
        </Suspense>
      )}
      {(tab.kind === 'sftp' || tab.kind === 'ftp') && tab.status === 'ready' && (
        <FileManager
          connectionId={tab.connectionId}
          kind={tab.kind}
          active={visible}
          initialPath={tab.path}
          onPathChange={(path) => onFilePath(tab.id, path)}
        />
      )}
      {tab.status === 'connecting' && <ConnectionStatePanel state="connecting" />}
      {tab.status === 'error' && (
        <ConnectionStatePanel
          state="error"
          error={tab.error}
          onReconnect={() => onReconnect(tab.id)}
        />
      )}
    </>
  )
}
