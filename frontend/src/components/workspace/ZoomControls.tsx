import { Icon } from '@iconify/react'
import { IconButton, Tooltip } from '../../ui'
import { clampZoom, zoomBounds, zoomStep } from '../../utils/zoom'

interface ZoomControlsProps {
  kind: 'ssh' | 'vnc'
  zoom: number
  onChange: (zoom: number) => void
}

/** Adjusts zoom for the active remote view without changing other tabs. */
export function ZoomControls({ kind, zoom, onChange }: ZoomControlsProps) {
  const { min, max } = zoomBounds(kind)

  return (
    <div className="status-zoom" aria-label={kind.toUpperCase() + ' zoom'}>
      <Tooltip title="Zoom out">
        <span>
          <IconButton
            aria-label="Zoom out"
            disabled={zoom <= min}
            onClick={() => onChange(clampZoom(kind, zoom - zoomStep))}
          >
            <Icon
              icon="material-symbols-light:zoom-out"
              width={22}
              height={22}
              aria-hidden="true"
            />
          </IconButton>
        </span>
      </Tooltip>
      <span className="status-zoom-value" aria-live="polite">
        {zoom}%
      </span>
      <Tooltip title="Zoom in">
        <span>
          <IconButton
            aria-label="Zoom in"
            disabled={zoom >= max}
            onClick={() => onChange(clampZoom(kind, zoom + zoomStep))}
          >
            <Icon icon="material-symbols-light:zoom-in" width={22} height={22} aria-hidden="true" />
          </IconButton>
        </span>
      </Tooltip>
    </div>
  )
}
