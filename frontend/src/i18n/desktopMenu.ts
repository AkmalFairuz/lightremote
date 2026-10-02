import { desktopRuntime, isMacDesktop } from '../desktop/runtime'
import { i18n, t } from './index'

/** Keep app-authored macOS menus localized even before authentication. */
export function syncDesktopMenuLanguage() {
  if (!isMacDesktop || !desktopRuntime) return
  let pending = Promise.resolve()
  function update() {
    const labels = {
      file: t('shell.file'),
      open: t('shell.openConnection') + '…',
      direct: t('shell.newDirectConnection') + '…',
      keys: t('shell.sshKeys') + '…',
      recent: t('shell.recentConnections'),
      emptyRecent: t('shell.noRecentConnections'),
      view: t('shell.view'),
      appearance: t('shell.appearance'),
      terminal: t('shell.terminalTheme'),
      system: t('shell.systemMode'),
      light: t('shell.lightMode'),
      dark: t('shell.darkMode'),
      'terminal:auto': t('files.autoFollowApp'),
      help: t('shell.help'),
      about: t('shell.aboutLightremote'),
      source: t('shell.sourceCode'),
    }
    pending = pending
      .then(async () => {
        await desktopRuntime?.Call.ByName(
          'main.DesktopService.UpdateMenuLabels',
          JSON.stringify(labels),
        )
      })
      .catch((cause) => console.error('Could not update native menu language:', cause))
  }
  i18n.on('languageChanged', update)
  update()
}
