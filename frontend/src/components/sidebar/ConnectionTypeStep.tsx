import { Card, CardActionArea } from '@mui/material'
import type { ConnectionKind } from '../../types'
import { Glyph } from '../common/Glyph'

const connectionTypes: {
  kind: ConnectionKind
  label: string
  description: string
  icon: string
}[] = [
  {
    kind: 'ssh',
    label: 'SSH',
    description: 'Remote terminal',
    icon: 'terminal',
  },
  {
    kind: 'vnc',
    label: 'VNC',
    description: 'Remote desktop',
    icon: 'desktop-windows-outline',
  },
  {
    kind: 'sftp',
    label: 'SFTP',
    description: 'Files over SSH',
    icon: 'folder-open-outline',
  },
  {
    kind: 'ftp',
    label: 'FTP / FTPS',
    description: 'FTP files with optional TLS',
    icon: 'folder-outline',
  },
]

interface ConnectionTypeStepProps {
  onSelect: (kind: ConnectionKind) => void
}

/** Presents only the protocol choice for a new connection. */
export function ConnectionTypeStep({ onSelect }: ConnectionTypeStepProps) {
  return (
    <div className="connection-type-grid" role="group" aria-label="Connection type">
      {connectionTypes.map((option) => (
        <Card key={option.kind} variant="outlined" className="connection-type-card">
          <CardActionArea
            className="connection-type-option"
            onClick={() => onSelect(option.kind)}
            aria-label={`Choose ${option.label}`}
          >
            <span className="connection-type-icon">
              <Glyph name={option.icon} size={56} />
            </span>
            <span className="connection-type-copy">
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </CardActionArea>
        </Card>
      ))}
    </div>
  )
}
