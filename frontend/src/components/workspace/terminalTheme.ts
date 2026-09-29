import type { ITheme } from '@xterm/xterm'
import { terminalPalettes } from './terminalPalettes'

export type TerminalThemeName = 'auto' | keyof typeof terminalPalettes

export const terminalThemeOptions: { name: TerminalThemeName; label: string }[] = [
  { name: 'auto', label: 'Auto (follow app)' },
  { name: 'ubuntu', label: 'Ubuntu' },
  { name: 'powerShell', label: 'PowerShell Blue' },
  { name: 'dracula', label: 'Dracula' },
  { name: 'oneDark', label: 'One Dark' },
  { name: 'nord', label: 'Nord' },
  { name: 'gruvboxDark', label: 'Gruvbox Dark' },
  { name: 'solarizedDark', label: 'Solarized Dark' },
  { name: 'solarizedLight', label: 'Solarized Light' },
]

/** Xterm colors chosen to remain legible in both application modes. */
export const terminalThemes: Record<'light' | 'dark', ITheme> = {
  light: {
    background: '#ffffff',
    foreground: '#242424',
    cursor: '#1976d2',
    selectionBackground: '#bbdefb',
    black: '#242424',
    red: '#b3261e',
    green: '#2e7d32',
    yellow: '#8a6200',
    blue: '#1565c0',
    magenta: '#8e24aa',
    cyan: '#007c91',
    white: '#616161',
    brightBlack: '#757575',
    brightRed: '#c62828',
    brightGreen: '#388e3c',
    brightYellow: '#a66f00',
    brightBlue: '#1976d2',
    brightMagenta: '#ab47bc',
    brightCyan: '#0097a7',
    brightWhite: '#242424',
  },
  dark: {
    background: '#161616',
    foreground: '#e6e6e6',
    cursor: '#90caf9',
    selectionBackground: '#3a5268',
    black: '#242424',
    red: '#ef9a9a',
    green: '#81c784',
    yellow: '#ffd180',
    blue: '#90caf9',
    magenta: '#ce93d8',
    cyan: '#80deea',
    white: '#eeeeee',
    brightBlack: '#757575',
    brightRed: '#ffcdd2',
    brightGreen: '#a5d6a7',
    brightYellow: '#ffe0b2',
    brightBlue: '#bbdefb',
    brightMagenta: '#e1bee7',
    brightCyan: '#b2ebf2',
    brightWhite: '#ffffff',
  },
}

export function resolveTerminalTheme(name: TerminalThemeName, appMode: 'light' | 'dark'): ITheme {
  return name === 'auto' ? terminalThemes[appMode] : terminalPalettes[name]
}
