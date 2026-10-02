import { t as translate } from '../../i18n'
import { useT } from '../../i18n/useT'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import { Alert, DialogPresence, Snackbar } from '../../ui'
import { VncFilesPanel } from './VncFilesPanel'
import { VncScreenshotDialog } from './VncScreenshotDialog'
import type { VncControls } from './vncControls'
import { openViewerSocket } from '../../desktop/viewerSocket'

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
  const t = useT()

  const viewport = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const cursorPosition = useRef<{ x: number; y: number } | null>(null)
  const previousZoom = useRef(zoom)
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
          setScreenshotError(t('files.couldNotCaptureTheVncDesktop'))
          return
        }
        try {
          setScreenshot({
            blob,
            filename: screenshotFilename(tabName),
            imageUrl: URL.createObjectURL(blob),
          })
        } catch {
          setScreenshotError(t('files.couldNotCaptureTheVncDesktop'))
        }
      }, 'image/png')
    } catch {
      setScreenshotError(t('files.couldNotCaptureTheVncDesktop'))
    }
  }, [tabName, t])
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
    function rememberCursor(point: { clientX: number; clientY: number }) {
      const canvas = container.current?.querySelector('canvas')
      if (!canvas) return
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      cursorPosition.current = {
        x: Math.max(0, Math.min(1, (point.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (point.clientY - bounds.top) / bounds.height)),
      }
    }
    const rememberZoomCursor = (event: Event) =>
      rememberCursor((event as CustomEvent<{ clientX: number; clientY: number }>).detail)
    element.addEventListener('pointermove', rememberCursor, true)
    element.addEventListener('vnc-zoom-anchor', rememberZoomCursor)
    return () => {
      element.removeEventListener('pointermove', rememberCursor, true)
      element.removeEventListener('vnc-zoom-anchor', rememberZoomCursor)
    }
  }, [])

  useLayoutEffect(() => {
    if (previousZoom.current === zoom) return
    previousZoom.current = zoom
    const element = viewport.current
    const canvas = container.current?.querySelector('canvas')
    if (!element || !canvas) return
    const before = canvas.getBoundingClientRect()
    if (!before.width || !before.height) return
    const view = element.getBoundingClientRect()
    const anchor = cursorPosition.current ?? {
      x: Math.max(
        0,
        Math.min(1, (view.left + element.clientWidth / 2 - before.left) / before.width),
      ),
      y: Math.max(
        0,
        Math.min(1, (view.top + element.clientHeight / 2 - before.top) / before.height),
      ),
    }
    // noVNC rescales on a later animation frame. Wait for the actual canvas size.
    const observer = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width === before.width && bounds.height === before.height) return
      if (!bounds.width || !bounds.height) return
      const viewportBounds = element.getBoundingClientRect()
      element.scrollTo({
        left:
          element.scrollLeft +
          bounds.left -
          viewportBounds.left +
          anchor.x * bounds.width -
          element.clientWidth / 2,
        top:
          element.scrollTop +
          bounds.top -
          viewportBounds.top +
          anchor.y * bounds.height -
          element.clientHeight / 2,
        behavior: 'instant',
      })
      observer.disconnect()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [zoom])

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
    cursorPosition.current = null
    const channel = openViewerSocket('vnc', sessionId)
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
        cause instanceof Error ? cause.message : translate('files.couldNotStartTheVncClient'),
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
      connectionErrorRef.current?.(translate('files.vncConnectionEnded'))
    })
    client.addEventListener('securityfailure', (event) => {
      if (disposed) return
      if (!settled) {
        reportedError = true
        settled = true
        const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
        connectionErrorRef.current?.(reason || translate('files.vncSecurityNegotiationFailed'))
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
            aria-label={t('connections.vncDesktop')}
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
