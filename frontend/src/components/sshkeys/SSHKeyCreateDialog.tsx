import { useT } from '../../i18n/useT'
import { useState, type FormEvent } from 'react'
import { resourcesApi } from '../../api/resources'
import { storeSSHKey } from '../../api/sshKeys'
import { useAppDispatch, useAppSelector } from '../../state/hooks'
import type { SSHKey } from '../../types'
import { errorMessage } from '../../types'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '../../ui'
import { Notice } from '../common/Notice'
import { SSHPrivateKeyFields } from '../sidebar/SSHPrivateKeyFields'

interface Props {
  onClose: () => void
  onCreated: (key: SSHKey) => void
}

export function SSHKeyCreateDialog({ onClose, onCreated }: Props) {
  const t = useT()

  const dispatch = useAppDispatch()
  const csrfToken = useAppSelector((state) => state.auth.csrfToken)
  const [name, setName] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!privateKey) {
      setError(t('keys.chooseAPrivateKeyFile'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const created = await storeSSHKey({ name, privateKey, passphrase }, csrfToken)
      dispatch(resourcesApi.util.invalidateTags(['SSHKeys']))
      onCreated(created)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={(event) => void save(event)}>
        <DialogTitle>{t('keys.addSshKey')}</DialogTitle>
        <DialogContent className="dialog-fields">
          <Notice message={error} />
          <TextField
            label={t('keys.keyName')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <SSHPrivateKeyFields
            privateKeyFileName={fileName}
            passphrase={passphrase}
            onPrivateKey={setPrivateKey}
            onPrivateKeyFileName={setFileName}
            onPassphrase={setPassphrase}
          />
        </DialogContent>
        <DialogActions>
          <Button type="submit" variant="contained" disabled={busy}>
            {t('keys.addKey')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
