import { useCallback, useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import { Alert, DialogPresence, Snackbar } from '../../ui'
import { VncFilesPanel } from './VncFilesPanel'
import { VncScreenshotDialog } from './VncScreenshotDialog'
import type { VncControls } from './vncControls'

const cursorPreferenceKey = 'lightremote.vnc.cursorMarker'
const wheelLinePixels = 16

function initialCursorPreference(): boolean {
  try {
    return localStorage.getItem(cursorPreferenceKey) !== 'off'
  } catch {
    return true
  }
}

function screenshotFilename(tabName: string): string {
  const safeName = tabName.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'vnc'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${safeName}-${timestamp}.png`
}

interface VncCanvasProps {
  tabId: string
  tabName: string
  sessionId: string
  connectionId: string
  readOnly: boolean
  fileTransfer: boolean
  active: boolean
  zoom: number
  filePath?: string
  filesOpen: boolean
  filesWidth: number | null
  onFilePath: (tabId: string, path: string) => void
  onFilesOpen: (tabId: string, open: boolean) => void
  onFilesWidth: (tabId: string, width: number) => void
  onConnected?: () => void
  onConnectionError?: (message: string) => void
  onControls: (tabId: string, controls: VncControls | null) => void
}

export function VncCanvas({
  tabId,
  tabName,
  sessionId,
  connectionId,
  readOnly,
  fileTransfer,
  active,
  zoom,
  filePath,
  filesOpen,
  filesWidth,
  onFilePath,
  onFilesOpen,
  onFilesWidth,
  onConnected,
  onConnectionError,
  onControls,
}: VncCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const localCursorRef = useRef(true)
  const filesOpenRef = useRef(filesOpen)
  const filesOpenActionRef = useRef(onFilesOpen)
  const connectedRef = useRef(onConnected)
  const connectionErrorRef = useRef(onConnectionError)
  const [localCursor, setLocalCursor] = useState(initialCursorPreference)
  const [connected, setConnected] = useState(false)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)
  const [screenshot, setScreenshot] = useState<{
    blob: Blob
    filename: string
    imageUrl: string
  } | null>(null)
  const sendCtrlAltDel = useCallback(() => rfb.current?.sendCtrlAltDel(), [])
  const takeScreenshot = useCallback(() => {
    const client = rfb.current
    if (!client) return
    setScreenshotError(null)
    try {
      client.toBlob((blob) => {
        if (!blob) {
          setScreenshotError('Could not capture the VNC desktop.')
          return
        }
        try {
          setScreenshot({
            blob,
            filename: screenshotFilename(tabName),
            imageUrl: URL.createObjectURL(blob),
          })
        } catch {
          setScreenshotError('Could not capture the VNC desktop.')
        }
      }, 'image/png')
    } catch {
      setScreenshotError('Could not capture the VNC desktop.')
    }
  }, [tabName])
  const toggleFiles = useCallback(() => {
    if (!fileTransfer) return
    filesOpenActionRef.current(tabId, !filesOpenRef.current)
  }, [fileTransfer, tabId])
  const toggleLocalCursor = useCallback(() => {
    setLocalCursor((enabled) => {
      try {
        localStorage.setItem(cursorPreferenceKey, enabled ? 'off' : 'on')
      } catch {
        // The current tab still applies the selected cursor preference.
      }
      return !enabled
    })
  }, [])

  useEffect(() => {
    filesOpenRef.current = filesOpen
    filesOpenActionRef.current = onFilesOpen
  }, [filesOpen, onFilesOpen])

  useEffect(() => {
    onControls(tabId, {
      connected,
      filesOpen,
      localCursor,
      sendCtrlAltDel,
      takeScreenshot,
      toggleFiles,
      toggleLocalCursor,
    })
    return () => onControls(tabId, null)
  }, [
    connected,
    filesOpen,
    localCursor,
    onControls,
    sendCtrlAltDel,
    takeScreenshot,
    tabId,
    toggleFiles,
    toggleLocalCursor,
  ])

  useEffect(() => {
    localCursorRef.current = localCursor
    if (rfb.current) rfb.current.showDotCursor = localCursor
  }, [localCursor])

  useEffect(() => {
    connectedRef.current = onConnected
    connectionErrorRef.current = onConnectionError
  }, [onConnected, onConnectionError])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const panZoomedView = (event: WheelEvent) => {
      if (event.altKey) return
      const horizontal = element.scrollWidth > element.clientWidth
      const vertical = element.scrollHeight > element.clientHeight
      if (!horizontal && !vertical) return
      event.preventDefault()
      event.stopPropagation()
      let scale = 1
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) scale = wheelLinePixels
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) scale = element.clientHeight
      const x = event.shiftKey || !vertical ? event.deltaX + event.deltaY : event.deltaX
      const y = event.shiftKey ? 0 : event.deltaY
      element.scrollBy(x * scale, y * scale)
    }
    element.addEventListener('wheel', panZoomedView, { capture: true, passive: false })
    return () => element.removeEventListener('wheel', panZoomedView, true)
  }, [])

  useEffect(() => {
    if (!container.current) return
    const url = new URL(`/api/sessions/${sessionId}/ws`, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const channel = new WebSocket(url.toString())
    let settled = false
    let reportedError = false
    let disposed = false
    channel.addEventListener('close', (event) => {
      if (disposed) return
      if (!event.reason) return
      reportedError = true
      settled = true
      connectionErrorRef.current?.(event.reason)
    })
    let client: RFB
    try {
      client = new RFB(container.current, channel)
    } catch (cause) {
      channel.close()
      connectionErrorRef.current?.(
        cause instanceof Error ? cause.message : 'Could not start the VNC client.',
      )
      return
    }
    client.scaleViewport = true
    client.viewOnly = readOnly
    client.resizeSession = false
    client.background = 'var(--lr-vnc-bg)'
    client.showDotCursor = localCursorRef.current
    client.addEventListener('connect', () => {
      if (disposed) return
      setConnected(true)
      if (!settled) {
        settled = true
        connectedRef.current?.()
      }
    })
    client.addEventListener('disconnect', () => {
      if (disposed) return
      setConnected(false)
      if (reportedError) return
      if (!settled) settled = true
      connectionErrorRef.current?.('VNC connection ended.')
    })
    client.addEventListener('securityfailure', (event) => {
      if (disposed) return
      if (!settled) {
        reportedError = true
        settled = true
        const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
        connectionErrorRef.current?.(reason || 'VNC security negotiation failed.')
      }
    })
    rfb.current = client

    return () => {
      disposed = true
      client.disconnect()
      rfb.current = null
    }
  }, [sessionId, readOnly])

  return (
    <div className={`vnc-workspace ${active ? '' : 'inactive-vnc'}`}>
      <div className="vnc-content">
        <div className="vnc-viewport" ref={viewport}>
          <div
            className="vnc-canvas"
            ref={container}
            aria-label="VNC desktop"
            style={{
              width: `${zoom}%`,
              height: `${zoom}%`,
            }}
          />
        </div>
        {fileTransfer && filesOpen && connected && (
          <VncFilesPanel
            connectionId={connectionId}
            active={active}
            initialPath={filePath}
            onPathChange={(path) => onFilePath(tabId, path)}
            width={filesWidth}
            onWidthChange={(width) => onFilesWidth(tabId, width)}
          />
        )}
      </div>
      <Snackbar
        open={Boolean(screenshotError)}
        autoHideDuration={5500}
        onClose={() => setScreenshotError(null)}
      >
        <Alert severity="error" onClose={() => setScreenshotError(null)}>
          {screenshotError}
        </Alert>
      </Snackbar>
      <DialogPresence>
        {screenshot && (
          <VncScreenshotDialog
            blob={screenshot.blob}
            filename={screenshot.filename}
            imageUrl={screenshot.imageUrl}
            onClose={() => setScreenshot(null)}
          />
        )}
      </DialogPresence>
    </div>
  )
}
