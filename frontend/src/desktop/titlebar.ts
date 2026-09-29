import type { MouseEvent } from 'react'
import { desktopRuntime, isDesktop, isMacDesktop } from './runtime'

/** Treats empty header space like a title bar outside macOS's native gesture. */
export function toggleWindowOnTitlebarDoubleClick(event: MouseEvent<HTMLElement>) {
  if (!isDesktop || isMacDesktop || !desktopRuntime) return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('button, a, input, [role="button"], .window-controls')
  ) {
    return
  }
  void desktopRuntime.Window.ToggleMaximise()
}
