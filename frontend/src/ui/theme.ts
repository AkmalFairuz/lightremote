import type { Localization } from '@mui/material/locale'
import { createTheme } from '@mui/material/styles'

/** Shared Material UI theme for LightRemote. */
export function createAppTheme(direction: 'ltr' | 'rtl' = 'ltr', localization?: Localization) {
  return createTheme(
    {
      direction,
      cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },
      colorSchemes: {
        light: {
          palette: {
            primary: { main: '#1976d2' },
            background: { default: '#f6f6f6', paper: '#fff' },
            text: { primary: '#252525', secondary: '#666' },
          },
        },
        dark: {
          palette: {
            primary: { main: '#90caf9' },
            background: { default: '#121212', paper: '#1e1e1e' },
            text: { primary: '#e8e8e8', secondary: '#b0b0b0' },
          },
        },
      },
      typography: {
        fontFamily: 'Roboto, Arial, sans-serif',
        fontSize: 13,
        button: { textTransform: 'none', fontWeight: 600 },
      },
      components: {
        MuiButton: {
          defaultProps: { disableElevation: true },
        },
        MuiPaper: {
          styleOverrides: { root: { backgroundImage: 'none' } },
        },
        MuiDialog: {
          styleOverrides: {
            paper: { width: 'min(calc(100vw - 24px), 560px)' },
          },
        },
        MuiMenu: {
          styleOverrides: {
            paper: { minWidth: 164 },
          },
        },
        MuiMenuItem: {
          styleOverrides: {
            root: {
              columnGap: 6,
              '& .MuiListItemIcon-root': { minWidth: 18 },
            },
          },
        },
      },
    },
    localization ?? {},
  )
}

export const theme = createAppTheme()
