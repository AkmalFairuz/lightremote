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
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const { bytesPerSecond, remainingSeconds } = transferMetrics(
    transfer,
    Math.max(now, transfer.samples.at(-1)?.time ?? now),
  )
  const action = transfer.direction === 'upload' ? 'Uploading' : 'Downloading'
  const finishing = transfer.total > 0 && transfer.loaded >= transfer.total
  const estimate = finishing
    ? 'Finishing…'
    : transfer.total <= 0
      ? 'Time remaining unavailable'
      : remainingSeconds === null
        ? 'Estimating time remaining…'
        : `About ${formatRemainingTime(remainingSeconds)} remaining`

  return (
    <div className="files-transfer">
      <div className="files-transfer-label">
        <span title={`${action} ${transfer.name}`}>
          {action} {transfer.name}
        </span>
        <span>
          {formatBytes(transfer.loaded)}
          {transfer.total > 0 && ` / ${formatBytes(transfer.total)}`}
        </span>
      </div>
      <div className="files-transfer-details">
        <span>
          {bytesPerSecond === null ? 'Calculating speed…' : `${formatBytes(bytesPerSecond)}/s`}
        </span>
        <span>{estimate}</span>
      </div>
      <progress
        aria-label={`${action} ${transfer.name}`}
        max={transfer.total > 0 ? transfer.total : undefined}
        value={transfer.total > 0 ? Math.min(transfer.loaded, transfer.total) : undefined}
      />
    </div>
  )
}
