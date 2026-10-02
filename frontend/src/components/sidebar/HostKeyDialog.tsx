import { useT } from '../../i18n/useT'
import { Trans } from 'react-i18next'
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
  const t = useT()

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
        setError(t('connections.theHostKeyChangedWhileThisDialogWasOpenCloseItAndTryAgain'))
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      setApproving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {changed ? t('connections.sshHostKeyChanged') : t('connections.verifySshHostKey')}
      </DialogTitle>
      <DialogContent className="host-key-content">
        <p className="host-key-message" role={changed ? 'alert' : undefined}>
          <Trans
            shouldUnescape
            tOptions={{ interpolation: { escapeValue: true } }}
            i18nKey="connections.fingerprint"
            values={{
              name: connection.name,
              address: `${connection.host}:${connection.port}`,
              fingerprint:
                observed ?? (checking ? t('connections.checking') : t('common.unavailable')),
            }}
            components={{
              name: <strong />,
              address: <span className="host-key-address" />,
              fingerprint: <code className="host-key-fingerprint" />,
            }}
          />{' '}
          {connection.hostKeyFingerprint && (
            <>
              <Trans
                shouldUnescape
                tOptions={{ interpolation: { escapeValue: true } }}
                i18nKey="connections.previousFingerprint"
                values={{ fingerprint: connection.hostKeyFingerprint }}
                components={{ fingerprint: <code className="host-key-fingerprint" /> }}
              />{' '}
            </>
          )}
          {changed && (
            <strong className="host-key-warning">{t('connections.theHostKeyHasChanged')} </strong>
          )}
          {t('connections.compareTheServerFingerprintWithATrustedSourceBeforeContinuing')}
        </p>
        <Notice message={error} />
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          onClick={() => void approveKey()}
          disabled={!observed || checking || approving}
        >
          {t('connections.trustHostKey')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
