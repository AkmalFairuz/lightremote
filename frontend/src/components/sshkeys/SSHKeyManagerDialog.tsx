import { useT } from '../../i18n/useT'
import { useState, type FormEvent } from 'react'
import {
  useDeleteSSHKeyMutation,
  useRenameSSHKeyMutation,
  useSshKeysQuery,
} from '../../api/resources'
import type { SSHKey } from '../../types'
import { errorMessage } from '../../types'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogPresence,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
} from '../../ui'
import { ConfirmDialog } from '../common/ActionDialogs'
import { Glyph } from '../common/Glyph'
import { Notice } from '../common/Notice'
import { SSHKeyCreateDialog } from './SSHKeyCreateDialog'
import { SSHKeyGenerateDialog } from './SSHKeyGenerateDialog'

interface Props {
  onClose: () => void
}

interface SSHKeyRowProps {
  sshKey: SSHKey
  onDelete: () => void
}

function SSHKeyRow({ sshKey, onDelete }: SSHKeyRowProps) {
  const t = useT()

  const [renameKey] = useRenameSSHKeyMutation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(sshKey.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name === sshKey.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renameKey({ id: sshKey.id, name }).unwrap()
      setEditing(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function cancelRename() {
    setName(sshKey.name)
    setError(null)
    setEditing(false)
  }

  return (
    <div className={`ssh-key-row ${editing ? 'ssh-key-row-editing' : ''}`}>
      {editing ? (
        <form className="ssh-key-rename" onSubmit={(event) => void rename(event)}>
          <input
            aria-label={t('common.newName', { name: sshKey.name })}
            autoFocus
            required
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                cancelRename()
              }
            }}
            disabled={busy}
          />
          <IconButton type="submit" aria-label={t('keys.saveSshKeyName')} disabled={busy}>
            <Glyph name="check" size={18} />
          </IconButton>
          <IconButton
            type="button"
            aria-label={t('connections.cancelRename')}
            onClick={cancelRename}
            disabled={busy}
          >
            <Glyph name="close" size={18} />
          </IconButton>
          {error && (
            <small className="ssh-key-rename-error" role="alert">
              {error}
            </small>
          )}
        </form>
      ) : (
        <>
          <span className="ssh-key-name">{sshKey.name}</span>
          <IconButton
            aria-label={t('common.actionsFor', { name: sshKey.name })}
            onClick={(event) => {
              setAnchor(event.currentTarget)
              setMenuOpen(true)
            }}
          >
            <Glyph name="more-vert" size={18} />
          </IconButton>
        </>
      )}
      <Menu
        anchorEl={anchor}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onClosed={() => setAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            setName(sshKey.name)
            setError(null)
            setEditing(true)
          }}
        >
          {t('connections.rename')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            onDelete()
          }}
        >
          {t('connections.delete')}
        </MenuItem>
      </Menu>
    </div>
  )
}

export function SSHKeyManagerDialog({ onClose }: Props) {
  const t = useT()

  const { data: keys = [], error } = useSshKeysQuery()
  const [deleteKey] = useDeleteSSHKeyMutation()
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deleting, setDeleting] = useState<SSHKey | null>(null)

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{t('shell.sshKeys')}</DialogTitle>
        <DialogContent className="dialog-fields ssh-key-manager-content">
          <Notice message={error ? t('keys.couldNotLoadSshKeys') : null} />
          {keys.length === 0 && <p>{t('keys.noSshKeysSavedYet')}</p>}
          <div className="ssh-key-list">
            {keys.map((key) => (
              <SSHKeyRow key={key.id} sshKey={key} onDelete={() => setDeleting(key)} />
            ))}
          </div>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setAdding(true)}>
            {t('keys.importKey')}
          </Button>
          <Button variant="contained" onClick={() => setGenerating(true)}>
            {t('keys.generateKey')}
          </Button>
        </DialogActions>
      </Dialog>
      <DialogPresence>
        {adding && (
          <SSHKeyCreateDialog onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
        )}
      </DialogPresence>
      <DialogPresence>
        {generating && <SSHKeyGenerateDialog onClose={() => setGenerating(false)} />}
      </DialogPresence>
      <DialogPresence>
        {deleting && (
          <ConfirmDialog
            title={t('keys.deleteSshKey')}
            message={t('keys.deleteKey', { name: deleting.name })}
            actionLabel={t('connections.delete')}
            onClose={() => setDeleting(null)}
            onConfirm={async () => {
              await deleteKey(deleting.id).unwrap()
            }}
          />
        )}
      </DialogPresence>
    </>
  )
}
