import { useT } from '../../i18n/useT'
import { useState, type FormEvent } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '../../ui'
import { useCreateFolderMutation } from '../../api/resources'
import { errorMessage } from '../../types'
import { Notice } from '../common/Notice'

interface FolderDialogProps {
  parentId: string | null
  onClose: () => void
}

/** Creates a folder under the parent chosen from the sidebar. */
export function FolderDialog({ parentId, onClose }: FolderDialogProps) {
  const t = useT()

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [createFolder, { isLoading }] = useCreateFolderMutation()

  /** Persists the new folder without changing its selected parent. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    try {
      await createFolder({ name, parentId }).unwrap()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={save}>
        <DialogTitle>{t('connections.newFolder')}</DialogTitle>
        <DialogContent className="dialog-fields">
          <Notice message={error} />
          <TextField
            label={t('connections.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button type="submit" variant="contained" disabled={isLoading}>
            {t('connections.createFolder')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
