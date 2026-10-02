import { useT } from '../../i18n/useT'
import { formatNumber } from '../../i18n/format'
import { useLocale } from '../../i18n/useLocale'
import { IconButton, Tooltip } from '../../ui'
import { Glyph } from '../common/Glyph'
import { clampZoom, zoomBounds, zoomStep } from '../../utils/zoom'

interface ZoomControlsProps {
  kind: 'ssh' | 'telnet' | 'vnc'
  zoom: number
  onChange: (zoom: number) => void
}

/** Adjusts zoom for the active remote view without changing other tabs. */
export function ZoomControls({ kind, zoom, onChange }: ZoomControlsProps) {
  const t = useT()

  const locale = useLocale()

  const { min, max } = zoomBounds(kind)

  return (
    <div
      className="status-zoom"
      aria-label={t('files.zoomControls', { protocol: kind.toUpperCase() })}
    >
      <Tooltip title={t('files.zoomOut')}>
        <span>
          <IconButton
            aria-label={t('files.zoomOut')}
            disabled={zoom <= min}
            onClick={() => onChange(clampZoom(kind, zoom - zoomStep))}
          >
            <Glyph name="zoom-out" size={22} />
          </IconButton>
        </span>
      </Tooltip>
      <span className="status-zoom-value" aria-live="polite">
        {formatNumber(zoom, 0, locale)}%
      </span>
      <Tooltip title={t('files.zoomIn')}>
        <span>
          <IconButton
            aria-label={t('files.zoomIn')}
            disabled={zoom >= max}
            onClick={() => onChange(clampZoom(kind, zoom + zoomStep))}
          >
            <Glyph name="zoom-in" size={22} />
          </IconButton>
        </span>
      </Tooltip>
    </div>
  )
}
