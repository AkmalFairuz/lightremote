import { useEffect, useState } from 'react'
import { desktopRuntime, isWindowsDesktop } from '../../desktop/runtime'

export function WindowDragRegion({ title }: { title?: string }) {
  if (!isWindowsDesktop) return null

  return (
    <div className="window-drag-region">
      {title && <span className="window-drag-title">{title}</span>}
    </div>
  )
}

/** Replaces the native caption buttons in frameless Windows windows. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isWindowsDesktop || !desktopRuntime) return
    let disposed = false

    async function refreshMaximized() {
      if (!desktopRuntime) return
      try {
        const value = await desktopRuntime.Window.IsMaximised()
        if (!disposed) setMaximized(value)
      } catch {
        // Keep the last known state if the window is closing.
      }
    }

    void refreshMaximized()
    window.addEventListener('resize', refreshMaximized)
    return () => {
      disposed = true
      window.removeEventListener('resize', refreshMaximized)
    }
  }, [])

  if (!isWindowsDesktop || !desktopRuntime) return null

  async function toggleMaximized() {
    if (!desktopRuntime) return
    await desktopRuntime.Window.ToggleMaximise()
    setMaximized(await desktopRuntime.Window.IsMaximised())
  }

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className="window-control-button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void desktopRuntime?.Window.Minimise()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 12.5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="window-control-button"
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void toggleMaximized()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {maximized ? (
            <>
              <path d="M5 3.5h8v8H5" />
              <path d="M3 5.5h8v8H3z" />
            </>
          ) : (
            <path d="M3 3h10v10H3z" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="window-control-button window-control-close"
        aria-label="Close window"
        title="Close"
        onClick={() => void desktopRuntime?.Window.Close()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 3.5l9 9m0-9-9 9" />
        </svg>
      </button>
    </div>
  )
}
