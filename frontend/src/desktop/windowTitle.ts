import { desktopRuntime } from './runtime'

/** Mirrors React's document title into each desktop window's native title. */
export function syncDesktopWindowTitle(): void {
  if (!desktopRuntime) return

  const titleElement = document.querySelector('title')
  if (!titleElement) return

  let currentTitle = ''
  function updateTitle() {
    if (!desktopRuntime || document.title === currentTitle) return
    currentTitle = document.title
    void desktopRuntime.Window.SetTitle(currentTitle).catch(() => {
      currentTitle = ''
    })
  }

  const observer = new MutationObserver(updateTitle)
  observer.observe(titleElement, { childList: true, characterData: true, subtree: true })
  updateTitle()
}
