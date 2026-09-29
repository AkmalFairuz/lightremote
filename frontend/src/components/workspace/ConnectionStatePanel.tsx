import { Button, CircularProgress } from '../../ui'
import { Glyph } from '../common/Glyph'

interface ConnectionStatePanelProps {
  state: 'connecting' | 'error'
  error?: string
  onReconnect?: () => void
}

/** Shows connection progress or a failure inside the reserved workspace tab. */
export function ConnectionStatePanel({ state, error, onReconnect }: ConnectionStatePanelProps) {
  return (
    <div className="connection-state-panel" role={state === 'error' ? 'alert' : 'status'}>
      {state === 'connecting' ? (
        <CircularProgress size={26} />
      ) : (
        <Glyph name="error-outline" size={28} />
      )}
      <strong>{state === 'connecting' ? 'Connecting…' : 'Connection failed'}</strong>
      {state === 'error' && error && <span>{error}</span>}
      {state === 'error' && onReconnect && (
        <Button variant="contained" onClick={onReconnect}>
          Reconnect
        </Button>
      )}
    </div>
  )
}
