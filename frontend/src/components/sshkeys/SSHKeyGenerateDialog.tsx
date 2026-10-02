import { useT } from '../../i18n/useT'
import { useState, type FormEvent } from 'react'
import { resourcesApi } from '../../api/resources'
import { generateSSHKey, storeSSHKey } from '../../api/sshKeys'
import { useAppDispatch, useAppSelector } from '../../state/hooks'
import { errorMessage, type GeneratedSSHKey, type SSHKeyAlgorithm } from '../../types'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  PasswordField,
  TextField,
} from '../../ui'
import { Notice } from '../common/Notice'
import { Glyph } from '../common/Glyph'
import { saveTextFile } from '../../desktop/actions'
import { isDesktop } from '../../desktop/viewerSocket'

interface Props {
  onClose: () => void
}

function downloadKey(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function keyFilename(name: string): string {
  const safeName = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.+$/g, '')
  return safeName || 'ssh-key'
}

export function SSHKeyGenerateDialog({ onClose }: Props) {
  const t = useT()

  const dispatch = useAppDispatch()
  const csrfToken = useAppSelector((state) => state.auth.csrfToken)
  const [name, setName] = useState('')
  const [algorithm, setAlgorithm] = useState<SSHKeyAlgorithm>('ed25519')
  const [passphrase, setPassphrase] = useState('')
  const [generated, setGenerated] = useState<GeneratedSSHKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [storing, setStoring] = useState(false)
  const [stored, setStored] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await generateSSHKey({ name, algorithm, passphrase }, csrfToken)
      setGenerated(result)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function storeKey() {
    if (!generated || stored) return
    setStoring(true)
    setError(null)
    try {
      await storeSSHKey({ name, privateKey: generated.privateKey, passphrase }, csrfToken)
      setStored(true)
      dispatch(resourcesApi.util.invalidateTags(['SSHKeys']))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setStoring(false)
    }
  }

  function close() {
    if (!storing) onClose()
  }

  const filename = keyFilename(name)

  function saveKey(content: string, name: string) {
    if (isDesktop) {
      void saveTextFile(name, content).catch((cause) => setError(errorMessage(cause)))
    } else {
      downloadKey(content, name)
    }
  }

  return (
    <Dialog open onClose={close} fullWidth maxWidth="xs">
      {generated ? (
        <>
          <DialogTitle>{t('keys.sshKeyGenerated')}</DialogTitle>
          <DialogContent className="dialog-fields">
            <Notice message={error} />
            <p>
              {stored
                ? t('keys.savedToSshKeysDownloadThePrivateKeyBeforeClosingIfYouNeedALocalCopy')
                : t('keys.thisKeyIsNotSavedYetDownloadTheFilesOrStoreThePrivateKeyInSshKeys')}
            </p>
          </DialogContent>
          <DialogActions className="ssh-key-created-actions" disableSpacing>
            <Button
              type="button"
              variant="outlined"
              startIcon={<Glyph name="download" size={18} />}
              onClick={() => saveKey(generated.privateKey, filename)}
            >
              {t('connections.privateKey')}
            </Button>
            <Button
              type="button"
              variant="outlined"
              startIcon={<Glyph name="download" size={18} />}
              onClick={() => saveKey(generated.publicKey, `${filename}.pub`)}
            >
              {t('keys.publicKey')}
            </Button>
            <Button
              variant="contained"
              disabled={storing || stored}
              onClick={() => void storeKey()}
            >
              {stored ? t('keys.stored') : t('keys.storeKey')}
            </Button>
          </DialogActions>
        </>
      ) : (
        <form onSubmit={(event) => void generate(event)}>
          <DialogTitle>{t('keys.generateSshKey')}</DialogTitle>
          <DialogContent className="dialog-fields">
            <Notice message={error} />
            <TextField
              label={t('keys.keyName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <TextField
              select
              label={t('keys.algorithm')}
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value as SSHKeyAlgorithm)}
            >
              <MenuItem value="ed25519">Ed25519</MenuItem>
              <MenuItem value="ecdsa_p256">ECDSA P-256</MenuItem>
              <MenuItem value="rsa4096">RSA 4096</MenuItem>
            </TextField>
            <PasswordField
              label={t('keys.passphraseOptional')}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="new-password"
              helperText={t('keys.protectsTheDownloadedPrivateKey')}
            />
          </DialogContent>
          <DialogActions>
            <Button type="submit" variant="contained" disabled={busy}>
              {t('keys.generateKey')}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  )
}
