import { useState, type FormEvent } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  PasswordField,
  Switch,
  TextField,
} from '../../ui'
import { useCreateUserMutation, useUpdateUserMutation } from '../../api/auth'
import { setUser } from '../../state/authSlice'
import { useAppDispatch, useAppSelector } from '../../state/hooks'
import { errorMessage, type User } from '../../types'
import { Notice } from '../common/Notice'

export function UserDialog({ user, onClose }: { user?: User; onClose: () => void }) {
  const dispatch = useAppDispatch()
  const currentUser = useAppSelector((state) => state.auth.user)
  const [createUser, { isLoading: creating }] = useCreateUserMutation()
  const [updateUser, { isLoading: updating }] = useUpdateUserMutation()
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>(user?.role ?? 'user')
  const [disabled, setDisabled] = useState(user?.disabled ?? false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      if (user) {
        const updated = await updateUser({
          id: user.id,
          changes: { email, role, disabled, ...(password ? { password } : {}) },
        }).unwrap()
        if (updated.id === currentUser?.id) dispatch(setUser(updated))
      } else {
        await createUser({ email, password, role }).unwrap()
      }
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={save}>
        <DialogTitle>{user ? 'Edit user' : 'Add user'}</DialogTitle>
        <DialogContent className="dialog-fields">
          <Notice message={error} />
          <TextField
            label="Email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            select
            label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value as 'admin' | 'user')}
          >
            <MenuItem value="user">User</MenuItem>
            <MenuItem value="admin">Administrator</MenuItem>
          </TextField>
          <PasswordField
            label={user ? 'New password' : 'Password'}
            required={!user}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            slotProps={{ htmlInput: { minLength: 6 } }}
            helperText={
              user ? 'Leave blank to keep the current password.' : 'At least 6 characters.'
            }
          />
          {user && (
            <FormControlLabel
              control={
                <Switch
                  checked={disabled}
                  onChange={(event) => setDisabled(event.target.checked)}
                />
              }
              label="Disable account"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button type="submit" variant="contained" disabled={creating || updating}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
