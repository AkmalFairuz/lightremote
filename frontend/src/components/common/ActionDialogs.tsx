import { useT } from '../../i18n/useT'
import { useState, type FormEvent } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '../../ui'
import { errorMessage } from '../../types'
import { Notice } from './Notice'

interface ConfirmDialogProps {
  title: string
  message: string
  actionLabel: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function ConfirmDialog({
  title,
  message,
  actionLabel,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent className="dialog-fields">
        <p>{message}</p>
        <Notice message={error} />
      </DialogContent>
      <DialogActions>
        <Button color="error" variant="contained" disabled={busy} onClick={() => void confirm()}>
          {actionLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

interface TextPromptDialogProps {
  title: string
  label: string
  initialValue?: string
  actionLabel: string
  onClose: () => void
  onConfirm: (value: string) => Promise<void>
}

export function TextPromptDialog({
  title,
  label,
  initialValue = '',
  actionLabel,
  onClose,
  onConfirm,
}: TextPromptDialogProps) {
  const t = useT()

  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!value || value === '.' || value === '..' || value.includes('/')) {
      setError(t('common.enterANameWithoutASlash'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(value)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent className="dialog-fields">
          <Notice message={error} />
          <TextField
            label={label}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button type="submit" variant="contained" disabled={busy}>
            {actionLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
