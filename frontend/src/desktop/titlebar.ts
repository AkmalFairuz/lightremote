import type { MouseEvent } from 'react'
import { desktopRuntime, isWindowsDesktop } from './runtime'

/** Treats empty header space like a native Windows title bar. */
export function toggleWindowOnTitlebarDoubleClick(event: MouseEvent<HTMLElement>) {
  if (!isWindowsDesktop || !desktopRuntime) return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('button, a, input, [role="button"], .window-controls')
  ) {
    return
  }
  void desktopRuntime.Window.ToggleMaximise()
}
