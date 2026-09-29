import { useSyncExternalStore } from 'react'
import { terminalThemeOptions, type TerminalThemeName } from './terminalTheme'

const storageKey = 'lightremote.terminal.theme'
const changeEvent = 'lightremote-terminal-theme-change'
const validNames = new Set(terminalThemeOptions.map((option) => option.name))
let fallbackTheme: TerminalThemeName = 'auto'

function isTerminalThemeName(value: string | null): value is TerminalThemeName {
  return value !== null && validNames.has(value as TerminalThemeName)
}

function currentTerminalTheme(): TerminalThemeName {
  try {
    const stored = localStorage.getItem(storageKey)
    if (isTerminalThemeName(stored)) return stored
  } catch {
    // The in-memory preference remains available if storage is blocked.
  }
  return fallbackTheme
}

function subscribe(listener: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key !== storageKey) return
    fallbackTheme = isTerminalThemeName(event.newValue) ? event.newValue : 'auto'
    listener()
  }

  window.addEventListener(changeEvent, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(changeEvent, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setTerminalThemePreference(name: TerminalThemeName): void {
  fallbackTheme = name
  try {
    localStorage.setItem(storageKey, name)
  } catch {
    // Keep the selected theme in this browser tab.
  }
  window.dispatchEvent(new Event(changeEvent))
}

export function useTerminalThemePreference(): TerminalThemeName {
  return useSyncExternalStore(subscribe, currentTerminalTheme, () => 'auto')
}
