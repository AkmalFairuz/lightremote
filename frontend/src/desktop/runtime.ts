export const isDesktop = import.meta.env.VITE_DESKTOP === 'true'

// Keep the Wails runtime out of browser builds; importing it starts its bridge.
export const desktopRuntime = isDesktop ? await import('@wailsio/runtime') : null

export const isWindowsDesktop =
  isDesktop && (desktopRuntime?.System.IsWindows() || navigator.userAgent.includes('Windows'))
if (isWindowsDesktop) {
  document.body.classList.add('windows-desktop')
}
