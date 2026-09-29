import { Collapse } from '@mui/material'
import type { CSSProperties } from 'react'
import type { Connection, Folder } from '../../types'
import { ConnectionRow } from './ConnectionRow'
import { FolderRow } from './FolderRow'
import { orderedItems, type SidebarOrder } from './sidebarOrder'
import { folderExpandDurationMs, sidebarIndentPixels } from './sidebarDimensions'

interface FolderBranchProps {
  folder: Folder
  folders: Folder[]
  connections: Connection[]
  order: SidebarOrder
  expanded: Record<string, boolean>
  activeFolderId: string | null
  contentWidth: number
  depth?: number
  onToggle: (id: string) => void
  onOpenConnection: (connection: Connection) => void
  onAddItem: (folder: Folder) => void
  onEditConnection: (connection: Connection) => void
  onHostKey: (connection: Connection) => void
  onNotice: (message: string) => void
}

export function FolderBranch(props: FolderBranchProps) {
  const { folder, folders, connections, expanded, order, contentWidth, depth = 0 } = props
  const open = expanded[folder.id] !== false
  const children = orderedItems(folder.id, folders, connections, order)

  return (
    <div
      className="folder-branch"
      role="treeitem"
      aria-expanded={open}
      style={
        {
          width: contentWidth ? Math.max(0, contentWidth - depth * sidebarIndentPixels) : undefined,
          '--sidebar-indent': `${depth * sidebarIndentPixels}px`,
        } as CSSProperties
      }
    >
      <FolderRow
        folder={folder}
        open={open}
        highlighted={props.activeFolderId === folder.id}
        onToggle={() => props.onToggle(folder.id)}
        onAddItem={() => props.onAddItem(folder)}
      />
      <Collapse
        in={open}
        timeout={folderExpandDurationMs}
        unmountOnExit
        className="folder-children-collapse"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="folder-children" role="group">
          {children.map((child) => {
            if (child.kind === 'folder') {
              const nested = folders.find((folder) => folder.id === child.id)
              return nested ? (
                <FolderBranch key={child.id} {...props} folder={nested} depth={depth + 1} />
              ) : null
            }
            const connection = connections.find((entry) => entry.id === child.id)
            return connection ? (
              <ConnectionRow
                key={child.id}
                connection={connection}
                contentWidth={contentWidth}
                depth={depth + 1}
                onOpen={props.onOpenConnection}
                onEdit={props.onEditConnection}
                onHostKey={props.onHostKey}
                onNotice={props.onNotice}
              />
            ) : null
          })}
        </div>
      </Collapse>
    </div>
  )
}
