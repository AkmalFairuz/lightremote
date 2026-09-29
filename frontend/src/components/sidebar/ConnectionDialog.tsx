import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogPresence,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  PasswordField,
  Switch,
  TextField,
} from '../../ui'
import {
  useCreateConnectionMutation,
  useCreateDirectConnectionMutation,
  useSshKeysQuery,
  useUpdateConnectionMutation,
} from '../../api/resources'
import { useAppDispatch } from '../../state/hooks'
import { closeConnectionTabs } from '../../state/workspaceSlice'
import {
  errorMessage,
  type AuthType,
  type Connection,
  type ConnectionInput,
  type ConnectionKind,
  type Folder,
  type ProxyInput,
  type SSHKey,
  type VncEncoding,
} from '../../types'
import { Notice } from '../common/Notice'
import { Glyph } from '../common/Glyph'
import { ConnectionTypeStep } from './ConnectionTypeStep'
import { FolderPickerDialog } from './FolderPickerDialog'
import { ProxyFields } from './ProxyFields'
import { SSHKeyCreateDialog } from '../sshkeys/SSHKeyCreateDialog'

interface ConnectionDialogProps {
  connection?: Connection
  direct?: boolean
  initialFolderId?: string | null
  folders: Folder[]
  onClose: () => void
  onNotice: (message: string) => void
  onDirectCreated?: (connection: Connection) => void
  onSavedAndConnect?: (connection: Connection) => void
}

const defaultPorts: Record<ConnectionKind, number> = { ssh: 22, sftp: 22, ftp: 21, vnc: 5900 }

type VncAccessMode = 'full' | 'read_only' | 'read_only_files'

function initialVncAccessMode(connection?: Connection): VncAccessMode {
  if (!connection?.vncReadOnly) return 'full'
  return connection.vncFileTransfer === false ? 'read_only' : 'read_only_files'
}

function folderPath(folders: Folder[], folderId: string): string[] {
  if (!folderId) return ['Root']
  const names: string[] = []
  const visited = new Set<string>()
  let current = folders.find((folder) => folder.id === folderId)
  while (current && !visited.has(current.id)) {
    names.unshift(current.name)
    visited.add(current.id)
    const parentId = current.parentId
    current = folders.find((folder) => folder.id === parentId)
  }
  return ['Root', ...names]
}

export function ConnectionDialog({
  connection,
  direct = false,
  initialFolderId,
  folders,
  onClose,
  onNotice,
  onDirectCreated,
  onSavedAndConnect,
}: ConnectionDialogProps) {
  const dispatch = useAppDispatch()
  const [createConnection, { isLoading: creating }] = useCreateConnectionMutation()
  const [createDirectConnection, { isLoading: creatingDirect }] =
    useCreateDirectConnectionMutation()
  const [updateConnection, { isLoading: updating }] = useUpdateConnectionMutation()
  const { data: sshKeys = [] } = useSshKeysQuery()
  const [name, setName] = useState(connection?.name ?? '')
  const [kind, setKind] = useState<ConnectionKind>(connection?.kind ?? 'ssh')
  const [step, setStep] = useState<'type' | 'details'>(connection ? 'details' : 'type')
  const [folderId, setFolderId] = useState(connection?.folderId ?? initialFolderId ?? '')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const folderPathRef = useRef<HTMLSpanElement>(null)
  const folderSegments = folderPath(folders, folderId)
  const [host, setHost] = useState(connection?.host ?? '')
  const [port, setPort] = useState(String(connection?.port ?? 22))
  const [username, setUsername] = useState(connection?.username ?? '')
  const [authType, setAuthType] = useState<AuthType>(connection?.authType ?? 'password')
  const [ftpTls, setFtpTls] = useState(connection?.ftpTls ?? false)
  const [vncEncoding, setVncEncoding] = useState<VncEncoding>(connection?.vncEncoding ?? 'auto')
  const [vncAccessMode, setVncAccessMode] = useState<VncAccessMode>(
    initialVncAccessMode(connection),
  )
  const [password, setPassword] = useState('')
  const [sshKeyId, setSSHKeyId] = useState(connection?.sshKeyId ?? '')
  const [newSSHKey, setNewSSHKey] = useState<SSHKey | null>(null)
  const [addSSHKeyOpen, setAddSSHKeyOpen] = useState(false)
  const availableSSHKeys =
    newSSHKey && !sshKeys.some((key) => key.id === newSSHKey.id) ? [...sshKeys, newSSHKey] : sshKeys
  const [proxyEnabled, setProxyEnabled] = useState(Boolean(connection?.proxy))
  const [proxy, setProxy] = useState<ProxyInput>({
    type: connection?.proxy?.type ?? 'socks5',
    host: connection?.proxy?.host ?? '',
    port: connection?.proxy?.port ?? 1080,
    username: connection?.proxy?.username ?? '',
  })
  const [error, setError] = useState<string | null>(null)

  useLayoutEffect(() => {
    const path = folderPathRef.current
    if (path) path.scrollLeft = path.scrollWidth
  }, [folderId, folders])

  function changeKind(next: ConnectionKind) {
    if (next === kind) return
    setKind(next)
    setPort(String(defaultPorts[next]))
    setAuthType('password')
    setSSHKeyId('')
    setFtpTls(false)
  }

  function dialogTitle() {
    if (connection) return 'Edit connection'
    if (step === 'type') {
      return direct ? 'New direct connection · Choose type' : 'New connection · Choose type'
    }
    const protocol = kind === 'ftp' ? 'FTP / FTPS' : kind.toUpperCase()
    return direct ? `Direct ${protocol} connection` : `New ${protocol} connection`
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (step === 'type') return
    // Enter submits the first button (Save); the other button requests a connection too.
    const saveAndConnect =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'connect'
    setError(null)
    const portNumber = Number(port)
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError('Enter a port between 1 and 65535.')
      return
    }
    if (authType === 'private_key' && !sshKeyId) {
      setError('Choose or add an SSH key.')
      return
    }
    if (proxyEnabled && proxy.password && !proxy.username) {
      setError('Enter a proxy username to use a password.')
      return
    }

    const input: ConnectionInput = {
      name: direct ? host : name,
      kind,
      folderId: direct ? null : folderId || null,
      host,
      port: portNumber,
      username,
      authType,
      sshKeyId: authType === 'private_key' ? sshKeyId : null,
      proxy: proxyEnabled ? { ...proxy } : null,
    }

    if (kind === 'ftp') input.ftpTls = ftpTls
    if (kind === 'vnc') {
      input.vncEncoding = vncEncoding
      input.vncReadOnly = vncAccessMode !== 'full'
      input.vncFileTransfer = vncAccessMode !== 'read_only'
    }
    if (input.proxy && !input.proxy.password) delete input.proxy.password
    if (authType === 'password' && password) {
      input.secret = { password }
    }

    try {
      if (direct) {
        const created = await createDirectConnection(input).unwrap()
        onClose()
        onDirectCreated?.(created)
        return
      }
      if (connection) {
        await updateConnection({ id: connection.id, input }).unwrap()
        dispatch(closeConnectionTabs(connection.id))
        onClose()
        return
      }
      const created = await createConnection(input).unwrap()
      onClose()
      if (saveAndConnect) onSavedAndConnect?.(created)
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      onNotice(message)
    }
  }

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <form onSubmit={save}>
          <DialogTitle>{dialogTitle()}</DialogTitle>
          <DialogContent className={step === 'type' ? 'connection-type-content' : 'dialog-fields'}>
            {step === 'type' ? (
              <ConnectionTypeStep
                onSelect={(next) => {
                  changeKind(next)
                  setStep('details')
                }}
              />
            ) : (
              <>
                <Notice message={error} />
                <div className="form-grid">
                  {!direct && (
                    <TextField
                      label="Display name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  )}
                  {connection && (
                    <TextField
                      select
                      label="Protocol"
                      value={kind}
                      onChange={(event) => changeKind(event.target.value as ConnectionKind)}
                    >
                      <MenuItem value="ssh">SSH terminal</MenuItem>
                      <MenuItem value="vnc">VNC desktop</MenuItem>
                      <MenuItem value="sftp">SFTP files</MenuItem>
                      <MenuItem value="ftp">FTP / FTPS files</MenuItem>
                    </TextField>
                  )}
                  <TextField
                    label="Host"
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                    required
                  />
                  <TextField
                    label="Port"
                    type="text"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    required
                    slotProps={{
                      htmlInput: { inputMode: 'numeric', pattern: '[0-9]{1,5}', maxLength: 5 },
                    }}
                  />
                  <TextField
                    label="Username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required={kind !== 'vnc'}
                  />
                  <TextField
                    select
                    label="Authentication"
                    value={authType}
                    onChange={(event) => setAuthType(event.target.value as AuthType)}
                  >
                    {kind === 'vnc' && <MenuItem value="none">No password</MenuItem>}
                    <MenuItem value="password">Password</MenuItem>
                    {(kind === 'ssh' || kind === 'sftp') && (
                      <MenuItem value="private_key">Private key</MenuItem>
                    )}
                  </TextField>
                  {!direct && (
                    <TextField
                      className="connection-folder-field"
                      label="Folder"
                      value=""
                      onClick={() => setFolderPickerOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setFolderPickerOpen(true)
                        }
                      }}
                      slotProps={{
                        inputLabel: { shrink: true },
                        input: {
                          startAdornment: (
                            <InputAdornment position="start" className="connection-folder-path">
                              <span className="connection-folder-path-content" ref={folderPathRef}>
                                {folderSegments.map((segment, index) => (
                                  <span className="connection-folder-segment" key={index}>
                                    {index > 0 && <Glyph name="chevron-right" size={17} />}
                                    <span className="connection-folder-name">{segment}</span>
                                  </span>
                                ))}
                              </span>
                            </InputAdornment>
                          ),
                        },
                        htmlInput: {
                          readOnly: true,
                          'aria-label': 'Choose folder',
                          'aria-haspopup': 'dialog',
                        },
                      }}
                    />
                  )}
                  {kind === 'vnc' && (
                    <TextField
                      select
                      label="Encoding"
                      value={vncEncoding}
                      onChange={(event) => setVncEncoding(event.target.value as VncEncoding)}
                    >
                      <MenuItem value="auto">Auto</MenuItem>
                      <MenuItem value="copyrect">CopyRect + Raw</MenuItem>
                      <MenuItem value="tight">Tight</MenuItem>
                      <MenuItem value="zlib">Zlib</MenuItem>
                      <MenuItem value="hextile">Hextile</MenuItem>
                      <MenuItem value="zrle">ZRLE</MenuItem>
                      <MenuItem value="raw">Raw</MenuItem>
                    </TextField>
                  )}
                  {kind === 'vnc' && (
                    <TextField
                      select
                      label="Access mode"
                      value={vncAccessMode}
                      onChange={(event) => setVncAccessMode(event.target.value as VncAccessMode)}
                    >
                      <MenuItem value="full">Full access</MenuItem>
                      <MenuItem value="read_only">Read only</MenuItem>
                      <MenuItem value="read_only_files">Read only with file transfer</MenuItem>
                    </TextField>
                  )}
                </div>
                {kind === 'ftp' && (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={ftpTls}
                        onChange={(event) => setFtpTls(event.target.checked)}
                      />
                    }
                    label="Explicit FTPS (TLS)"
                  />
                )}
                {authType === 'private_key' && (
                  <div className="ssh-key-picker">
                    <TextField
                      select
                      label="SSH key"
                      value={sshKeyId}
                      onChange={(event) => setSSHKeyId(event.target.value)}
                      required
                    >
                      {availableSSHKeys.length === 0 && (
                        <MenuItem value="" disabled>
                          No SSH keys saved
                        </MenuItem>
                      )}
                      {availableSSHKeys.map((key) => (
                        <MenuItem key={key.id} value={key.id}>
                          {key.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button type="button" variant="outlined" onClick={() => setAddSSHKeyOpen(true)}>
                      Add new key
                    </Button>
                  </div>
                )}
                {authType === 'password' && (
                  <PasswordField
                    label="Remote password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required={!connection}
                    autoComplete="new-password"
                    helperText={connection ? 'Leave blank to keep the saved password.' : undefined}
                  />
                )}
                <ProxyFields
                  enabled={proxyEnabled}
                  proxy={proxy}
                  editing={Boolean(connection)}
                  onEnabled={setProxyEnabled}
                  onChange={setProxy}
                />
              </>
            )}
          </DialogContent>
          {step === 'details' && (
            <DialogActions
              className={!connection && !direct ? 'connection-new-actions' : undefined}
              disableSpacing={!connection && !direct}
            >
              {!connection && (
                <Button type="button" onClick={() => setStep('type')}>
                  Back
                </Button>
              )}
              <Button
                variant={!connection && !direct ? 'outlined' : 'contained'}
                type="submit"
                value="save"
                disabled={creating || creatingDirect || updating}
              >
                {direct ? 'Connect' : 'Save connection'}
              </Button>
              {!connection && !direct && (
                <Button
                  variant="contained"
                  type="submit"
                  value="connect"
                  disabled={creating || creatingDirect || updating}
                >
                  Save &amp; connect
                </Button>
              )}
            </DialogActions>
          )}
        </form>
      </Dialog>
      <DialogPresence>
        {addSSHKeyOpen && (
          <SSHKeyCreateDialog
            onClose={() => setAddSSHKeyOpen(false)}
            onCreated={(key) => {
              setNewSSHKey(key)
              setSSHKeyId(key.id)
              setAddSSHKeyOpen(false)
            }}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {!direct && folderPickerOpen && (
          <FolderPickerDialog
            folders={folders}
            selectedId={folderId}
            onSelect={(id) => {
              setFolderId(id)
              setFolderPickerOpen(false)
            }}
            onClose={() => setFolderPickerOpen(false)}
          />
        )}
      </DialogPresence>
    </>
  )
}
