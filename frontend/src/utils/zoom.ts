import type { ConnectionKind } from '../types'

export const zoomStep = 10
export const defaultZoom = 100

/** Returns useful bounds for the selected remote view. */
export function zoomBounds(kind: ConnectionKind): { min: number; max: number } {
  return kind === 'ssh' || kind === 'telnet' ? { min: 70, max: 180 } : { min: 50, max: 200 }
}

/** Keeps a tab's zoom level within the range supported by its view. */
export function clampZoom(kind: ConnectionKind, value: number): number {
  const { min, max } = zoomBounds(kind)
  return Math.max(min, Math.min(max, value))
}
