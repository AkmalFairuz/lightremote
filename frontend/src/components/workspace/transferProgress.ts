interface ProgressSample {
  time: number
  loaded: number
}

export interface TransferProgress {
  loaded: number
  total: number
  samples: readonly ProgressSample[]
}

const rateWindowMs = 3000
const sampleIntervalMs = 200
const minimumElapsedMs = 500

/** Tracks a bounded recent history without counting the save dialog or file preparation. */
export function recordTransferProgress(
  progress: TransferProgress,
  loaded: number,
  total: number,
  time: number,
): TransferProgress {
  if (!Number.isFinite(loaded) || loaded < progress.loaded) return progress
  const samples = [...progress.samples]
  const sample = { time, loaded }
  if (samples.length >= 2 && time - samples[samples.length - 2].time < sampleIntervalMs) {
    samples[samples.length - 1] = sample
  } else {
    samples.push(sample)
  }
  while (samples.length > 2 && samples[1].time <= time - rateWindowMs) samples.shift()
  return { loaded, total: Number.isFinite(total) ? Math.max(0, total) : progress.total, samples }
}

/** Uses a rolling byte rate, including time since the latest progress event. */
export function transferMetrics(
  progress: TransferProgress,
  now: number,
): {
  bytesPerSecond: number | null
  remainingSeconds: number | null
} {
  const samples = progress.samples
  if (samples.length < 2 || now - samples[0].time < minimumElapsedMs) {
    return { bytesPerSecond: null, remainingSeconds: null }
  }

  const cutoff = now - rateWindowMs
  let baseline = samples[0]
  for (let index = 1; index < samples.length && baseline.time < cutoff; index += 1) {
    const next = samples[index]
    if (next.time <= cutoff) {
      baseline = next
    } else {
      const fraction = (cutoff - baseline.time) / (next.time - baseline.time)
      baseline = {
        time: cutoff,
        loaded: baseline.loaded + (next.loaded - baseline.loaded) * fraction,
      }
    }
  }

  const elapsedMs = now - baseline.time
  const bytesPerSecond =
    elapsedMs > 0 ? Math.max(0, ((progress.loaded - baseline.loaded) * 1000) / elapsedMs) : 0
  const remainingSeconds =
    progress.total > 0 && bytesPerSecond > 0
      ? Math.max(0, progress.total - progress.loaded) / bytesPerSecond
      : null
  return { bytesPerSecond, remainingSeconds }
}

export function formatRemainingTime(seconds: number): string {
  const rounded = Math.max(1, Math.ceil(seconds))
  if (rounded < 60) return `${rounded}s`
  const minutes = Math.floor(rounded / 60)
  if (minutes < 60) return `${minutes}m ${rounded % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
