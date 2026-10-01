import { useState, type FormEvent } from 'react'
import { Dialog as MuiDialog } from '@mui/material'
import {
  Button,
  DialogActions,
  DialogContent,
  PasswordField,
  TextField,
  Typography,
} from '../../ui'
import { useSetupMutation } from '../../api/auth'
import { setAuth } from '../../state/authSlice'
import { useAppDispatch } from '../../state/hooks'
import { errorMessage } from '../../types'
import { Notice } from '../common/Notice'

/** Creates the first administrator before any workspace content is available. */
export function SetupDialog() {
  const dispatch = useAppDispatch()
  const [setup, { isLoading }] = useSetupMutation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password !== confirmation) {
      setError('Passwords do not match.')
      return
    }
    try {
      const result = await setup({ email: email.trim(), password }).unwrap()
      dispatch(setAuth(result))
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <MuiDialog open fullWidth maxWidth="xs" aria-labelledby="setup-title">
      <form onSubmit={submit}>
        <DialogContent className="login-dialog-content">
          <Typography variant="h6" component="h1" id="setup-title">
            Set up LightRemote
          </Typography>
          <Typography>Create your administrator account to finish installation.</Typography>
          <Notice message={error} />
          <TextField
            label="Administrator email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={isLoading}
          />
          <PasswordField
            label="Password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={isLoading}
            slotProps={{ htmlInput: { minLength: 6 } }}
            helperText="At least 6 characters."
          />
          <PasswordField
            label="Confirm password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            disabled={isLoading}
          />
        </DialogContent>
        <DialogActions className="login-dialog-actions">
          <Button
            variant="contained"
            type="submit"
            fullWidth
            loading={isLoading}
            disabled={isLoading}
          >
            Complete installation
          </Button>
        </DialogActions>
      </form>
    </MuiDialog>
  )
}
