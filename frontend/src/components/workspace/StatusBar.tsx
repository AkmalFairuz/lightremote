import { useT } from '../../i18n/useT'
import type { t as Translator } from '../../i18n'
import { useLocale } from '../../i18n/useLocale'
import { useEffect, useRef, useState } from 'react'
import { useSessionDetailQuery } from '../../api/sessions'
import type { WorkspaceTab } from '../../state/workspaceSlice'
import { formatBytes } from '../../utils/formatBytes'
import { Glyph } from '../common/Glyph'
import { defaultZoom } from '../../utils/zoom'
import { Button } from '../../ui'
import type { VncControls } from './vncControls'
import { ZoomControls } from './ZoomControls'

const sessionPollingMs = 2000
const millisecondsPerSecond = 1000
const minimumRateIntervalSeconds = 0.001

function statusText(tab: WorkspaceTab | undefined, isError: boolean, t: typeof Translator): string {
  if (!tab) return t('files.selectAConnection')
  if (tab.status === 'connecting') return t('files.connectingProgress')
  if (tab.status === 'error') return t('files.connectionFailed')
  if (!tab.sessionId) return t('files.fileBrowser')
  return isError ? t('files.sessionEnded') : t('files.connecting')
}

export function StatusBar({
  tab,
  onZoom,
  vncControls,
}: {
  tab?: WorkspaceTab
  onZoom: (zoom: number) => void
  vncControls?: VncControls
}) {
  const t = useT()

  const locale = useLocale()

  const { currentData: data, isError } = useSessionDetailQuery(tab?.sessionId ?? '', {
    skip: !tab?.sessionId,
    pollingInterval: sessionPollingMs,
  })
  const previous = useRef<{ received: number; sent: number; at: number } | null>(null)
  const [rates, setRates] = useState({ received: 0, sent: 0 })
  const showBandwidth = Boolean(tab?.status === 'ready' && tab.sessionId && data)

  useEffect(() => {
    previous.current = null
  }, [tab?.sessionId])

  useEffect(() => {
    if (!data) return
    const now = Date.now()
    const current = data.metrics
    const last = previous.current
    if (last) {
      const seconds = Math.max((now - last.at) / millisecondsPerSecond, minimumRateIntervalSeconds)
      setRates({
        received: Math.max(0, (current.bytesReceived - last.received) / seconds),
        sent: Math.max(0, (current.bytesSent - last.sent) / seconds),
      })
    }
    previous.current = { received: current.bytesReceived, sent: current.bytesSent, at: now }
  }, [data])

  return (
    <footer className="status-bar">
      <span
        className={`status-left ${tab?.status === 'ready' && tab.sessionId && data ? 'status-online' : ''}`}
      >
        <span className="status-indicator">
          <Glyph name="circle" size={9} />
        </span>
        <span className="status-name">
          {tab ? `${tab.kind.toUpperCase()} · ${tab.name}` : t('shell.noActiveConnection')}
        </span>
      </span>
      {tab?.kind === 'vnc' && vncControls && (
        <div className="status-vnc-actions">
          <Button
            startIcon={<Glyph name="keyboard-command-key" size={14} />}
            aria-label={t('files.sendCtrlAltDel')}
            title={t('files.sendCtrlAltDel')}
            disabled={!vncControls.connected || tab.vncReadOnly}
            onClick={vncControls.sendCtrlAltDel}
          >
            <span className="status-vnc-label">{t('files.ctrlAltDel')}</span>
          </Button>
          {tab.vncFileTransfer !== false && (
            <Button
              startIcon={<Glyph name="folder-outline" size={14} />}
              aria-label={t('files.toggleVncFiles')}
              title={t('files.toggleVncFiles')}
              aria-pressed={vncControls.filesOpen}
              onClick={vncControls.toggleFiles}
            >
              <span className="status-vnc-label">{t('common.files')}</span>
            </Button>
          )}
          <Button
            startIcon={<Glyph name="mouse-outline" size={14} />}
            aria-label={t('files.showLocalCursorWhenTheServerHidesIt')}
            title={t('files.showLocalCursorWhenTheServerHidesIt')}
            aria-pressed={vncControls.localCursor}
            onClick={vncControls.toggleLocalCursor}
          >
            <span className="status-vnc-label">{t('files.cursor')}</span>
          </Button>
          <Button
            startIcon={<Glyph name="photo-camera-outline" size={14} />}
            aria-label={t('files.saveVncScreenshot')}
            title={t('files.saveVncScreenshot')}
            disabled={!vncControls.connected}
            onClick={vncControls.takeScreenshot}
          >
            <span className="status-vnc-label">{t('files.screenshot')}</span>
          </Button>
        </div>
      )}
      {tab && (tab.kind === 'ssh' || tab.kind === 'telnet' || tab.kind === 'vnc') && (
        <ZoomControls kind={tab.kind} zoom={tab.zoom ?? defaultZoom} onChange={onZoom} />
      )}
      <div className={showBandwidth ? 'status-metrics status-bandwidth' : 'status-metrics'}>
        {showBandwidth && data ? (
          <>
            <span title={t('files.browserToRemote')}>
              <Glyph name="arrow-upward" size={14} />{' '}
              {formatBytes(data.metrics.bytesReceived, locale)} ·{' '}
              {t('files.speed', { speed: formatBytes(rates.received, locale) })}
            </span>
            <span title={t('files.remoteToBrowser')}>
              <Glyph name="arrow-downward" size={14} />{' '}
              {formatBytes(data.metrics.bytesSent, locale)} ·{' '}
              {t('files.speed', { speed: formatBytes(rates.sent, locale) })}
            </span>
          </>
        ) : (
          <span>{statusText(tab, isError, t)}</span>
        )}
      </div>
    </footer>
  )
}
