import { useT } from '../../i18n/useT'
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
  const t = useT()

  return (
    <div className="form-section">
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />}
        label={t('connections.connectThroughAProxy')}
      />
      {enabled && (
        <>
          <div className="form-grid">
            <TextField
              select
              label={t('connections.proxyType')}
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
              label={t('connections.proxyHost')}
              value={proxy.host}
              onChange={(event) => onChange({ ...proxy, host: event.target.value })}
              required
            />
            <TextField
              label={t('connections.proxyPort')}
              type="number"
              value={proxy.port}
              onChange={(event) => onChange({ ...proxy, port: Number(event.target.value) })}
              required
              slotProps={{ htmlInput: { min: 1, max: 65535 } }}
            />
            <TextField
              label={t('connections.proxyUsername')}
              value={proxy.username}
              onChange={(event) => onChange({ ...proxy, username: event.target.value })}
            />
          </div>
          <PasswordField
            label={t('connections.proxyPassword')}
            value={proxy.password ?? ''}
            onChange={(event) => onChange({ ...proxy, password: event.target.value })}
            required={!editing && Boolean(proxy.username)}
            error={!proxy.username && Boolean(proxy.password)}
            helperText={
              !proxy.username && proxy.password
                ? t('connections.enterAProxyUsernameToUseAPassword')
                : editing
                  ? t(
                      'connections.leaveBlankToKeepThePasswordOnlyWhenTheProxySettingsAboveAreUnchanged',
                    )
                  : undefined
            }
            autoComplete="new-password"
          />
        </>
      )}
    </div>
  )
}
