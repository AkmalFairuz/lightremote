import { useT } from '../../i18n/useT'
import { useState } from 'react'
import { useUsersQuery } from '../../api/auth'
import { useAppSelector } from '../../state/hooks'
import type { User } from '../../types'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogPresence,
  DialogTitle,
  Paper,
} from '../../ui'
import { Glyph } from '../common/Glyph'
import { UserDialog } from './UserDialog'

/** Lists administrator-managed accounts in a dialog. */
export function UsersDialog({ onClose }: { onClose: () => void }) {
  const t = useT()

  const currentUser = useAppSelector((state) => state.auth.user)
  const { data: users = [], isLoading } = useUsersQuery(undefined, {
    skip: currentUser?.role !== 'admin',
  })
  const [editing, setEditing] = useState<User | 'new' | null>(null)

  if (currentUser?.role !== 'admin') return null

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{t('shell.manageUsers')}</DialogTitle>
        <DialogContent className="users-dialog-content">
          <Button
            variant="contained"
            startIcon={<Glyph name="person-add-outline" />}
            onClick={() => setEditing('new')}
          >
            {t('users.addUser')}
          </Button>
          <Paper variant="outlined" className="users-list users-dialog-list">
            {isLoading && (
              <div className="users-loading">
                <CircularProgress size={22} />
              </div>
            )}
            {users.map((user) => (
              <div className="user-row" key={user.id}>
                <div className="user-avatar">{user.email[0]?.toUpperCase()}</div>
                <div className="user-identity">
                  <strong>{user.email}</strong>
                  <span>
                    {user.role} {user.disabled && `· ${t('common.disabled')}`}
                  </span>
                </div>
                {user.id === currentUser.id && <span className="user-self">{t('users.you')}</span>}
                <Button onClick={() => setEditing(user)}>{t('users.edit')}</Button>
              </div>
            ))}
          </Paper>
        </DialogContent>
      </Dialog>
      <DialogPresence>
        {editing && (
          <UserDialog
            user={editing === 'new' ? undefined : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </DialogPresence>
    </>
  )
}
