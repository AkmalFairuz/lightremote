import { useState, type FormEvent } from 'react'
import { useChangePasswordMutation } from '../../api/auth'
import { useAppDispatch, useAppSelector } from '../../state/hooks'
import { resetWorkspace } from '../../state/workspaceSlice'
import { errorMessage } from '../../types'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  PasswordField,
} from '../../ui'
import { Notice } from '../common/Notice'
import { clearDetachedRegistry } from '../workspace/detachedTabs'

/** Changes the signed-in user's password in a dedicated account dialog. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch()
  const userId = useAppSelector((state) => state.auth.user?.id ?? '')
  const [changePassword, { isLoading }] = useChangePasswordMutation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  /** Rotates the password and clears work tabs invalidated by the backend. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(false)
    try {
      await changePassword({ currentPassword, newPassword }).unwrap()
      setCurrentPassword('')
      setNewPassword('')
      setSuccess(true)
      clearDetachedRegistry(userId)
      dispatch(resetWorkspace())
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={save}>
        <DialogTitle>Change password</DialogTitle>
        <DialogContent className="dialog-fields">
          <Notice message={error} />
          {success && (
            <Alert severity="success">Password changed. Other login sessions were revoked.</Alert>
          )}
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            required
            slotProps={{ htmlInput: { minLength: 6 } }}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            helperText="At least 6 characters."
          />
        </DialogContent>
        <DialogActions>
          <Button type="submit" variant="contained" disabled={isLoading}>
            Change password
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
