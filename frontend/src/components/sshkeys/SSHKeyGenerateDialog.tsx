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

  return (
    <Dialog open onClose={close} fullWidth maxWidth="xs">
      {generated ? (
        <>
          <DialogTitle>SSH key generated</DialogTitle>
          <DialogContent className="dialog-fields">
            <Notice message={error} />
            <p>
              {stored
                ? 'Saved to SSH keys. Download the private key before closing if you need a local copy.'
                : 'This key is not saved yet. Download the files or store the private key in SSH keys.'}
            </p>
          </DialogContent>
          <DialogActions className="ssh-key-created-actions" disableSpacing>
            <Button
              type="button"
              variant="outlined"
              startIcon={<Glyph name="download" size={18} />}
              onClick={() => downloadKey(generated.privateKey, filename)}
            >
              Private key
            </Button>
            <Button
              type="button"
              variant="outlined"
              startIcon={<Glyph name="download" size={18} />}
              onClick={() => downloadKey(generated.publicKey, `${filename}.pub`)}
            >
              Public key
            </Button>
            <Button
              variant="contained"
              disabled={storing || stored}
              onClick={() => void storeKey()}
            >
              {stored ? 'Stored' : 'Store key'}
            </Button>
          </DialogActions>
        </>
      ) : (
        <form onSubmit={(event) => void generate(event)}>
          <DialogTitle>Generate SSH key</DialogTitle>
          <DialogContent className="dialog-fields">
            <Notice message={error} />
            <TextField
              label="Key name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <TextField
              select
              label="Algorithm"
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value as SSHKeyAlgorithm)}
            >
              <MenuItem value="ed25519">Ed25519</MenuItem>
              <MenuItem value="ecdsa_p256">ECDSA P-256</MenuItem>
              <MenuItem value="rsa4096">RSA 4096</MenuItem>
            </TextField>
            <PasswordField
              label="Passphrase (optional)"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="new-password"
              helperText="Protects the downloaded private key."
            />
          </DialogContent>
          <DialogActions>
            <Button type="submit" variant="contained" disabled={busy}>
              Generate key
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  )
}
