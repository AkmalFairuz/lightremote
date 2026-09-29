import { useEffect, useRef, useState } from 'react'
import { useSessionDetailQuery } from '../../api/sessions'
import type { WorkspaceTab } from '../../state/workspaceSlice'
import { formatBytes } from '../../utils/formatBytes'
import { Glyph } from '../common/Glyph'
import { defaultZoom } from '../../utils/zoom'
import { Button } from '../../ui'
import type { VncControls } from './vncControls'
import { ZoomControls } from './ZoomControls'

const sessionPollingMs = 2000
const millisecondsPerSecond = 1000
const minimumRateIntervalSeconds = 0.001

function statusText(tab: WorkspaceTab | undefined, isError: boolean): string {
  if (!tab) return 'Select a connection'
  if (tab.status === 'connecting') return 'Connecting…'
  if (tab.status === 'error') return 'Connection failed'
  if (!tab.sessionId) return 'File browser'
  return isError ? 'Session ended' : 'Connecting'
}

export function StatusBar({
  tab,
  onZoom,
  vncControls,
}: {
  tab?: WorkspaceTab
  onZoom: (zoom: number) => void
  vncControls?: VncControls
}) {
  const { currentData: data, isError } = useSessionDetailQuery(tab?.sessionId ?? '', {
    skip: !tab?.sessionId,
    pollingInterval: sessionPollingMs,
  })
  const previous = useRef<{ received: number; sent: number; at: number } | null>(null)
  const [rates, setRates] = useState({ received: 0, sent: 0 })

  useEffect(() => {
    previous.current = null
  }, [tab?.sessionId])

  useEffect(() => {
    if (!data) return
    const now = Date.now()
    const current = data.metrics
    const last = previous.current
    if (last) {
      const seconds = Math.max((now - last.at) / millisecondsPerSecond, minimumRateIntervalSeconds)
      setRates({
        received: Math.max(0, (current.bytesReceived - last.received) / seconds),
        sent: Math.max(0, (current.bytesSent - last.sent) / seconds),
      })
    }
    previous.current = { received: current.bytesReceived, sent: current.bytesSent, at: now }
  }, [data])

  return (
    <footer className="status-bar">
      <span
        className={`status-left ${tab?.status === 'ready' && tab.sessionId && data ? 'status-online' : ''}`}
      >
        <span className="status-indicator">
          <Glyph name="circle" size={9} />
        </span>
        <span className="status-name">
          {tab ? `${tab.kind.toUpperCase()} · ${tab.name}` : 'No active connection'}
        </span>
      </span>
      {tab?.kind === 'vnc' && vncControls && (
        <div className="status-vnc-actions">
          <Button
            startIcon={<Glyph name="keyboard-command-key" size={14} />}
            aria-label="Send Ctrl+Alt+Del"
            title="Send Ctrl+Alt+Del"
            disabled={!vncControls.connected || tab.vncReadOnly}
            onClick={vncControls.sendCtrlAltDel}
          >
            <span className="status-vnc-label">Ctrl+Alt+Del</span>
          </Button>
          {tab.vncFileTransfer !== false && (
            <Button
              startIcon={<Glyph name="folder-outline" size={14} />}
              aria-label="Toggle VNC files"
              title="Toggle VNC files"
              aria-pressed={vncControls.filesOpen}
              onClick={vncControls.toggleFiles}
            >
              <span className="status-vnc-label">Files</span>
            </Button>
          )}
          <Button
            startIcon={<Glyph name="mouse-outline" size={14} />}
            aria-label="Show local cursor when the server hides it"
            title="Show local cursor when the server hides it"
            aria-pressed={vncControls.localCursor}
            onClick={vncControls.toggleLocalCursor}
          >
            <span className="status-vnc-label">Cursor</span>
          </Button>
          <Button
            startIcon={<Glyph name="photo-camera-outline" size={14} />}
            aria-label="Save VNC screenshot"
            title="Save VNC screenshot"
            disabled={!vncControls.connected}
            onClick={vncControls.takeScreenshot}
          >
            <span className="status-vnc-label">Screenshot</span>
          </Button>
        </div>
      )}
      {tab && (tab.kind === 'ssh' || tab.kind === 'vnc') && (
        <ZoomControls kind={tab.kind} zoom={tab.zoom ?? defaultZoom} onChange={onZoom} />
      )}
      <div className="status-metrics">
        {tab?.status === 'ready' && tab.sessionId && data ? (
          <>
            <span title="Browser to remote">
              <Glyph name="arrow-upward" size={14} /> {formatBytes(data.metrics.bytesReceived)} ·{' '}
              {formatBytes(rates.received)}/s
            </span>
            <span title="Remote to browser">
              <Glyph name="arrow-downward" size={14} /> {formatBytes(data.metrics.bytesSent)} ·{' '}
              {formatBytes(rates.sent)}/s
            </span>
          </>
        ) : (
          <span>{statusText(tab, isError)}</span>
        )}
      </div>
    </footer>
  )
}
