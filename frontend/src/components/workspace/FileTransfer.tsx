import { useT } from '../../i18n/useT'
import { useLocale } from '../../i18n/useLocale'
import { useEffect, useState } from 'react'
import { formatBytes } from '../../utils/formatBytes'
import { formatRemainingTime, transferMetrics, type TransferProgress } from './transferProgress'

export interface Transfer extends TransferProgress {
  id: string
  name: string
  direction: 'upload' | 'download'
}

/** Updates stalled rates and estimates without rerendering the directory list. */
export function FileTransfer({ transfer }: { transfer: Transfer }) {
  const t = useT()

  const locale = useLocale()

  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const { bytesPerSecond, remainingSeconds } = transferMetrics(
    transfer,
    Math.max(now, transfer.samples.at(-1)?.time ?? now),
  )
  const action = transfer.direction === 'upload' ? t('files.uploading') : t('files.downloading')
  const finishing = transfer.total > 0 && transfer.loaded >= transfer.total
  const estimate = finishing
    ? t('files.finishing')
    : transfer.total <= 0
      ? t('files.timeRemainingUnavailable')
      : remainingSeconds === null
        ? t('files.estimatingTimeRemaining')
        : t('files.remaining', { time: formatRemainingTime(remainingSeconds, locale) })

  return (
    <div className="files-transfer">
      <div className="files-transfer-label">
        <span title={t('common.namedAction', { action, name: transfer.name })}>
          {t('common.namedAction', { action, name: transfer.name })}
        </span>
        <span>
          {formatBytes(transfer.loaded, locale)}
          {transfer.total > 0 && ` / ${formatBytes(transfer.total, locale)}`}
        </span>
      </div>
      <div className="files-transfer-details">
        <span>
          {bytesPerSecond === null
            ? t('files.calculatingSpeed')
            : t('files.speed', { speed: formatBytes(bytesPerSecond, locale) })}
        </span>
        <span>{estimate}</span>
      </div>
      <progress
        aria-label={t('common.namedAction', { action, name: transfer.name })}
        max={transfer.total > 0 ? transfer.total : undefined}
        value={transfer.total > 0 ? Math.min(transfer.loaded, transfer.total) : undefined}
      />
    </div>
  )
}
