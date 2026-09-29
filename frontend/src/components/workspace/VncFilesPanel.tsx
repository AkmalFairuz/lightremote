import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { FileManager } from './FileManager'

const defaultPanelWidth = 240
const smallestPanelWidth = 120
const minimumDesktopWidth = 120
const keyboardResizeStep = 16

interface VncFilesPanelProps {
  connectionId: string
  active: boolean
  initialPath?: string
  onPathChange: (path: string) => void
  width: number | null
  onWidthChange: (width: number) => void
}

/** Shows the VNC file manager beside the desktop with a drag divider. */
export function VncFilesPanel({
  connectionId,
  active,
  initialPath,
  onPathChange,
  width,
  onWidthChange,
}: VncFilesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  function clampWidth(next: number): number {
    const contentWidth = panelRef.current?.parentElement?.getBoundingClientRect().width ?? 0
    // Keep part of the desktop visible even when the file panel is resized.
    const maximum = Math.max(smallestPanelWidth, contentWidth - minimumDesktopWidth)
    const minimum = Math.min(defaultPanelWidth, maximum)
    return Math.max(minimum, Math.min(maximum, next))
  }

  function resizeFromPointer(event: PointerEvent<HTMLDivElement>) {
    const content = panelRef.current?.parentElement?.getBoundingClientRect()
    if (content) onWidthChange(clampWidth(content.right - event.clientX))
  }

  function resizeFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const current = width ?? panelRef.current?.getBoundingClientRect().width ?? defaultPanelWidth
    const change = event.key === 'ArrowLeft' ? keyboardResizeStep : -keyboardResizeStep
    onWidthChange(clampWidth(current + change))
  }

  return (
    <div
      className="vnc-files"
      ref={panelRef}
      style={{ '--vnc-files-width': width ? `${width}px` : undefined } as CSSProperties}
    >
      <div
        className="vnc-files-resizer"
        role="separator"
        aria-label="Resize VNC file manager"
        aria-orientation="vertical"
        aria-valuenow={width ?? undefined}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const current = panelRef.current?.getBoundingClientRect().width
          if (current) onWidthChange(current)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeFromPointer(event)
        }}
        onKeyDown={resizeFromKeyboard}
      />
      <FileManager
        connectionId={connectionId}
        kind="vnc"
        active={active}
        initialPath={initialPath}
        onPathChange={onPathChange}
      />
    </div>
  )
}
