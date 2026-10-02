import { useT } from '../../i18n/useT'
import { Card, CardActionArea } from '@mui/material'
import { Dialog, DialogContent, DialogTitle } from '../../ui'
import { Glyph } from '../common/Glyph'

interface AddItemDialogProps {
  folderName: string
  onAddFolder: () => void
  onAddConnection: () => void
  onClose: () => void
}

/** Lets a folder's add action choose which item to create. */
export function AddItemDialog({
  folderName,
  onAddFolder,
  onAddConnection,
  onClose,
}: AddItemDialogProps) {
  const t = useT()

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {t('connections.addTo')} {folderName}
      </DialogTitle>
      <DialogContent className="folder-add-content">
        <div className="folder-add-options">
          <Card variant="outlined">
            <CardActionArea onClick={onAddFolder} className="folder-add-option">
              <Glyph name="create-new-folder-outline" size={32} />
              <strong>{t('connections.folder')}</strong>
              <span>{t('connections.addASubfolder')}</span>
            </CardActionArea>
          </Card>
          <Card variant="outlined">
            <CardActionArea onClick={onAddConnection} className="folder-add-option">
              <Glyph name="add-link" size={32} />
              <strong>{t('connections.connection')}</strong>
              <span>{t('connections.addARemoteConnection')}</span>
            </CardActionArea>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
