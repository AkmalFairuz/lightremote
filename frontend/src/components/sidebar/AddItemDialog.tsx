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
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add to {folderName}</DialogTitle>
      <DialogContent className="folder-add-content">
        <div className="folder-add-options">
          <Card variant="outlined">
            <CardActionArea onClick={onAddFolder} className="folder-add-option">
              <Glyph name="create-new-folder-outline" size={32} />
              <strong>Folder</strong>
              <span>Add a subfolder</span>
            </CardActionArea>
          </Card>
          <Card variant="outlined">
            <CardActionArea onClick={onAddConnection} className="folder-add-option">
              <Glyph name="add-link" size={32} />
              <strong>Connection</strong>
              <span>Add a remote connection</span>
            </CardActionArea>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
