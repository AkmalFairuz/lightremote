import { FormControlLabel, MenuItem, PasswordField, Switch, TextField } from '../../ui'
import type { ProxyInput } from '../../types'

interface ProxyFieldsProps {
  enabled: boolean
  proxy: ProxyInput
  editing: boolean
  onEnabled: (enabled: boolean) => void
  onChange: (proxy: ProxyInput) => void
}

export function ProxyFields({ enabled, proxy, editing, onEnabled, onChange }: ProxyFieldsProps) {
  return (
    <div className="form-section">
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />}
        label="Connect through a proxy"
      />
      {enabled && (
        <>
          <div className="form-grid">
            <TextField
              select
              label="Proxy type"
              value={proxy.type}
              onChange={(event) =>
                onChange({ ...proxy, type: event.target.value as ProxyInput['type'] })
              }
            >
              <MenuItem value="http">HTTP CONNECT</MenuItem>
              <MenuItem value="https">HTTPS CONNECT</MenuItem>
              <MenuItem value="socks5">SOCKS5</MenuItem>
            </TextField>
            <TextField
              label="Proxy host"
              value={proxy.host}
              onChange={(event) => onChange({ ...proxy, host: event.target.value })}
              required
            />
            <TextField
              label="Proxy port"
              type="number"
              value={proxy.port}
              onChange={(event) => onChange({ ...proxy, port: Number(event.target.value) })}
              required
              slotProps={{ htmlInput: { min: 1, max: 65535 } }}
            />
            <TextField
              label="Proxy username"
              value={proxy.username}
              onChange={(event) => onChange({ ...proxy, username: event.target.value })}
            />
          </div>
          <PasswordField
            label="Proxy password"
            value={proxy.password ?? ''}
            onChange={(event) => onChange({ ...proxy, password: event.target.value })}
            required={!editing && Boolean(proxy.username)}
            error={!proxy.username && Boolean(proxy.password)}
            helperText={
              !proxy.username && proxy.password
                ? 'Enter a proxy username to use a password.'
                : editing
                  ? 'Leave blank to keep the password only when the proxy settings above are unchanged.'
                  : undefined
            }
            autoComplete="new-password"
          />
        </>
      )}
    </div>
  )
}
