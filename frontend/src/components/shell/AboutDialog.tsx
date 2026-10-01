import { version } from '../../../package.json'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '../../ui'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" aria-labelledby="about-dialog-title">
      <DialogTitle id="about-dialog-title">About LightRemote</DialogTitle>
      <DialogContent>
        <p>Version {version}</p>
        <p>Remote desktop and file workspace.</p>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
