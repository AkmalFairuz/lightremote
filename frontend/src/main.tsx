import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { Provider } from 'react-redux'
import '@fontsource/roboto/latin-400.css'
import '@fontsource/roboto/latin-500.css'
import '@fontsource/roboto/latin-600.css'
import '@xterm/xterm/css/xterm.css'
import App from './App'
import { store } from './state/store'
import { theme } from './ui/theme'
import './styles/base.css'
import './styles/mui.css'
import './styles/shell.css'
import './styles/account-popover.css'
import './styles/view-menu.css'
import './styles/sidebar.css'
import './styles/workspace.css'
import './styles/vnc-screenshot.css'
import './styles/connection-state.css'
import './styles/zoom.css'
import './styles/forms.css'
import './styles/host-key.css'
import './styles/connection-wizard.css'
import './styles/folder-add.css'
import './styles/folder-picker.css'
import './styles/files.css'
import './styles/file-editor.css'

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ThemeProvider theme={theme} defaultMode="light" noSsr>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </Provider>,
)
