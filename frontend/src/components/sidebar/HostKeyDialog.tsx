import { useEffect, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '../../ui'
import { useApproveHostKeyMutation, useInspectHostKeyMutation } from '../../api/resources'
import { errorMessage, type Connection } from '../../types'
import { Notice } from '../common/Notice'

export function HostKeyDialog({
  connection,
  onClose,
  initialObserved = null,
  onApproved,
}: {
  connection: Connection
  onClose: () => void
  initialObserved?: string | null
  onApproved?: () => void | Promise<void>
}) {
  const [inspect] = useInspectHostKeyMutation()
  const [approve] = useApproveHostKeyMutation()
  const [observed, setObserved] = useState<string | null>(initialObserved)
  const [checking, setChecking] = useState(!initialObserved)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = Boolean(
    observed && connection.hostKeyFingerprint && observed !== connection.hostKeyFingerprint,
  )

  useEffect(() => {
    if (initialObserved) return
    let active = true
    void inspect(connection.id)
      .unwrap()
      .then(
        (result) => {
          if (active) {
            setObserved(result.fingerprint)
            setChecking(false)
          }
        },
        (cause) => {
          if (active) {
            setError(errorMessage(cause))
            setChecking(false)
          }
        },
      )
    return () => {
      active = false
    }
  }, [connection.id, initialObserved, inspect])

  async function approveKey() {
    if (!observed || approving) return
    setApproving(true)
    setError(null)
    try {
      await approve({ id: connection.id, fingerprint: observed }).unwrap()
      if (onApproved) {
        await onApproved()
      } else {
        onClose()
      }
    } catch (cause) {
      if ((cause as { status?: number })?.status === 409) {
        setObserved(null)
        setError('The host key changed while this dialog was open. Close it and try again.')
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      setApproving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{changed ? 'SSH host key changed' : 'Verify SSH host key'}</DialogTitle>
      <DialogContent className="host-key-content">
        <p className="host-key-message" role={changed ? 'alert' : undefined}>
          The server for <strong>{connection.name}</strong> (
          <span className="host-key-address">
            {connection.host}:{connection.port}
          </span>
          ) presents SSH fingerprint{' '}
          {observed ? (
            <code className="host-key-fingerprint">{observed}</code>
          ) : checking ? (
            <span className="host-key-pending">checking…</span>
          ) : (
            <span className="host-key-pending">unavailable</span>
          )}
          .{' '}
          {connection.hostKeyFingerprint && (
            <>
              The previously trusted fingerprint is{' '}
              <code className="host-key-fingerprint">{connection.hostKeyFingerprint}</code>.{' '}
            </>
          )}
          {changed && <strong className="host-key-warning">The host key has changed. </strong>}
          Compare the server fingerprint with a trusted source before continuing.
        </p>
        <Notice message={error} />
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          onClick={() => void approveKey()}
          disabled={!observed || checking || approving}
        >
          Trust host key
        </Button>
      </DialogActions>
    </Dialog>
  )
}
