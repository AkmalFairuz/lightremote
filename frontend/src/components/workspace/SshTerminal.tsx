import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import { useColorScheme } from '@mui/material/styles'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { resolveTerminalTheme } from './terminalTheme'
import { useTerminalThemePreference } from './terminalThemePreference'
import { openViewerSocket } from '../../desktop/viewerSocket'

const baseTerminalFontPixels = 13
const percentageScale = 100

interface SshTerminalProps {
  sessionId: string
  visible: boolean
  active: boolean
  zoom: number
  onConnected?: () => void
  onConnectionError?: (message: string) => void
}

export function SshTerminal({
  sessionId,
  visible,
  active,
  zoom,
  onConnected,
  onConnectionError,
}: SshTerminalProps) {
  const { mode, systemMode } = useColorScheme()
  const themePreference = useTerminalThemePreference()
  const appMode = mode === 'system' ? systemMode : mode
  const palette = resolveTerminalTheme(themePreference, appMode === 'dark' ? 'dark' : 'light')
  const paletteRef = useRef(palette)
  const container = useRef<HTMLDivElement>(null)
  const terminalInstance = useRef<Terminal | null>(null)
  const zoomRef = useRef(zoom)
  const visibleRef = useRef(visible)
  const activeRef = useRef(active)
  const fit = useRef<FitAddon | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const connectedRef = useRef(onConnected)
  const connectionErrorRef = useRef(onConnectionError)
  const lastSentSize = useRef<{ rows: number; cols: number } | null>(null)

  const fitAndResize = useCallback(() => {
    if (!visibleRef.current || !container.current?.offsetWidth || !container.current.offsetHeight)
      return
    const terminal = terminalInstance.current
    const fitAddon = fit.current
    if (!terminal || !fitAddon) return
    fitAddon.fit()
    const ws = socket.current
    const size = { rows: terminal.rows, cols: terminal.cols }
    if (
      ws?.readyState === WebSocket.OPEN &&
      (lastSentSize.current?.rows !== size.rows || lastSentSize.current.cols !== size.cols)
    ) {
      ws.send(JSON.stringify({ type: 'resize', ...size }))
      lastSentSize.current = size
    }
  }, [])

  useEffect(() => {
    paletteRef.current = palette
  }, [palette])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    connectedRef.current = onConnected
    connectionErrorRef.current = onConnectionError
  }, [onConnected, onConnectionError])

  useEffect(() => {
    if (!container.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: (baseTerminalFontPixels * zoomRef.current) / percentageScale,
      theme: paletteRef.current,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container.current)
    terminalInstance.current = terminal
    fit.current = fitAddon
    lastSentSize.current = null
    const initialFit = requestAnimationFrame(fitAndResize)

    const ws = openViewerSocket('ssh', sessionId)
    ws.binaryType = 'arraybuffer'
    socket.current = ws
    let settled = false
    let reportedError = false
    let disposed = false

    ws.addEventListener('open', () => {
      if (disposed) return
      fitAndResize()
      if (activeRef.current) terminal.focus()
    })
    ws.addEventListener('message', (event) => {
      if (disposed) return
      if (typeof event.data === 'string') {
        try {
          const control = JSON.parse(event.data) as { type: string; message: string }
          if (control.type === 'ready' && !settled) {
            settled = true
            connectedRef.current?.()
          } else if (control.type === 'error') {
            reportedError = true
            settled = true
            connectionErrorRef.current?.(control.message)
          }
        } catch {
          reportedError = true
          settled = true
          connectionErrorRef.current?.('Invalid terminal control message.')
        }
      } else {
        terminal.write(new Uint8Array(event.data as ArrayBuffer))
      }
    })
    ws.addEventListener('error', () => {
      if (disposed) return
      reportedError = true
      settled = true
      connectionErrorRef.current?.('Terminal connection failed.')
    })
    ws.addEventListener('close', (event) => {
      if (disposed) return
      if (!reportedError)
        connectionErrorRef.current?.(event.reason || 'Terminal connection closed.')
      settled = true
    })
    const input = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data))
    })
    const observer = new ResizeObserver(fitAndResize)
    observer.observe(container.current)

    return () => {
      disposed = true
      cancelAnimationFrame(initialFit)
      observer.disconnect()
      input.dispose()
      ws.close()
      socket.current = null
      fit.current = null
      lastSentSize.current = null
      terminalInstance.current = null
      terminal.dispose()
    }
  }, [sessionId, fitAndResize])

  useEffect(() => {
    if (terminalInstance.current) {
      terminalInstance.current.options.theme = palette
    }
  }, [palette])

  useEffect(() => {
    const terminal = terminalInstance.current
    if (!terminal) return
    terminal.options.fontSize = (baseTerminalFontPixels * zoom) / percentageScale
    const frame = requestAnimationFrame(fitAndResize)
    return () => cancelAnimationFrame(frame)
  }, [zoom, fitAndResize])

  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(fitAndResize)
    return () => cancelAnimationFrame(frame)
  }, [visible, fitAndResize])

  useEffect(() => {
    if (active) {
      const frame = requestAnimationFrame(() => {
        terminalInstance.current?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [active])

  return (
    <div
      className="terminal-view"
      aria-label="SSH terminal"
      style={{ '--lr-terminal-bg': palette.background } as CSSProperties}
    >
      <div className="terminal-host" ref={container} />
    </div>
  )
}
