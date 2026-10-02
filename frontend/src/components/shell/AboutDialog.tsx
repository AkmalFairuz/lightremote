import { useT } from '../../i18n/useT'
import { version } from '../../../package.json'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '../../ui'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT()

  return (
    <Dialog open onClose={onClose} maxWidth="xs" aria-labelledby="about-dialog-title">
      <DialogTitle id="about-dialog-title">{t('shell.aboutLightremote')}</DialogTitle>
      <DialogContent>
        <p>
          {t('shell.version')} {version}
        </p>
        <p>{t('shell.remoteDesktopAndFileWorkspace')}</p>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('shell.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
