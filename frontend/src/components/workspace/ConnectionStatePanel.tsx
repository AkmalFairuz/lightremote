import { useT } from '../../i18n/useT'
import { translateMessage } from '../../i18n'
import { useLocale } from '../../i18n/useLocale'
import { Button, CircularProgress } from '../../ui'
import { Glyph } from '../common/Glyph'

interface ConnectionStatePanelProps {
  state: 'connecting' | 'error'
  error?: string
  onReconnect?: () => void
}

/** Shows connection progress or a failure inside the reserved workspace tab. */
export function ConnectionStatePanel({ state, error, onReconnect }: ConnectionStatePanelProps) {
  const t = useT()

  const locale = useLocale()

  return (
    <div className="connection-state-panel" role={state === 'error' ? 'alert' : 'status'}>
      {state === 'connecting' ? (
        <CircularProgress size={26} />
      ) : (
        <Glyph name="error-outline" size={28} />
      )}
      <strong>
        {state === 'connecting' ? t('files.connectingProgress') : t('files.connectionFailed')}
      </strong>
      {state === 'error' && error && <span>{translateMessage(error, locale)}</span>}
      {state === 'error' && onReconnect && (
        <Button variant="contained" onClick={onReconnect}>
          {t('files.reconnect')}
        </Button>
      )}
    </div>
  )
}
