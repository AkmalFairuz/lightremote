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
import { useLoginMutation } from '../../api/auth'
import { Notice } from '../common/Notice'
import { setAuth } from '../../state/authSlice'
import { useAppDispatch } from '../../state/hooks'
import { errorMessage } from '../../types'

/** Requires an account before the workspace can be used. */
export function LoginDialog() {
  const dispatch = useAppDispatch()
  const [login, { isLoading }] = useLoginMutation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const result = await login({ email, password }).unwrap()
      dispatch(setAuth(result))
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <MuiDialog open fullWidth maxWidth="xs" aria-labelledby="login-title">
      <form onSubmit={submit}>
        <DialogContent className="login-dialog-content">
          <Typography variant="body1" component="h1" id="login-title">
            Please enter credentials to continue:
          </Typography>
          <Notice message={error} />
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <PasswordField
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
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
            Sign in
          </Button>
        </DialogActions>
      </form>
    </MuiDialog>
  )
}
