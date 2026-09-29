export const isDesktop = import.meta.env.VITE_DESKTOP === 'true'

// Keep the Wails runtime out of browser builds; importing it starts its bridge.
export const desktopRuntime = isDesktop ? await import('@wailsio/runtime') : null

export const isWindowsDesktop =
  isDesktop && (desktopRuntime?.System.IsWindows() || navigator.userAgent.includes('Windows'))
export const isMacDesktop = isDesktop && Boolean(desktopRuntime?.System.IsMac())
if (isDesktop) {
  document.body.classList.add('desktop-app')
}
if (isWindowsDesktop) {
  document.body.classList.add('windows-desktop')
}
if (isMacDesktop) {
  document.body.classList.add('mac-desktop')
}
