import { useMemo, useState } from 'react'
import { CircularProgress, DialogPresence, IconButton, InputAdornment, TextField } from '../../ui'
import { useConnectionsQuery, useFoldersQuery } from '../../api/resources'
import type { Connection, Folder } from '../../types'
import { Glyph } from '../common/Glyph'
import { ConnectionDialog } from './ConnectionDialog'
import { ConnectionRow } from './ConnectionRow'
import { FolderBranch } from './FolderBranch'
import { AddItemDialog } from './AddItemDialog'
import { FolderDialog } from './FolderDialog'
import { HostKeyDialog } from './HostKeyDialog'
import { SidebarDragContext } from './SidebarDragContext'
import { itemKey, orderedItems } from './sidebarOrder'
import { useSidebarDnD } from './useSidebarDnD'
import { useSidebarContentWidth } from './useSidebarContentWidth'

const emptyFolders: Folder[] = []
const emptyConnections: Connection[] = []

interface SidebarProps {
  onOpenConnection: (connection: Connection) => void
  onNotice: (message: string) => void
}

export function Sidebar({ onOpenConnection, onNotice }: SidebarProps) {
  const { data: folderData, isLoading: foldersLoading } = useFoldersQuery()
  const { data: connectionData, isLoading: connectionsLoading } = useConnectionsQuery()
  const folders = folderData ?? emptyFolders
  const connections = connectionData ?? emptyConnections
  const [search, setSearch] = useState('')
  const [folderDialog, setFolderDialog] = useState<{ parentId: string | null } | null>(null)
  const [addTarget, setAddTarget] = useState<Folder | 'root' | null>(null)
  const [connectionDialog, setConnectionDialog] = useState<{
    connection?: Connection
    parentId: string | null
  } | null>(null)
  const [hostKeyConnection, setHostKeyConnection] = useState<Connection | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const matchingConnections = useMemo(
    () =>
      connections.filter((connection) =>
        `${connection.name} ${connection.host} ${connection.kind}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [connections, search],
  )
  const { treeRef, contentWidth } = useSidebarContentWidth(
    folders,
    matchingConnections,
    expanded,
    search,
  )

  function toggleFolder(id: string) {
    setExpanded((current) => ({ ...current, [id]: current[id] === false }))
  }

  function addInsideTarget(kind: 'folder' | 'connection') {
    const parentId = addTarget === 'root' ? null : (addTarget?.id ?? null)
    if (parentId) {
      setExpanded((current) => ({ ...current, [parentId]: true }))
    }
    if (kind === 'folder') {
      setFolderDialog({ parentId })
    } else {
      setConnectionDialog({ parentId })
    }
    setAddTarget(null)
  }

  const { order, drag } = useSidebarDnD(folders, connections, onNotice, (id) => {
    setExpanded((current) => ({ ...current, [id]: true }))
  })

  return (
    <SidebarDragContext.Provider value={drag}>
      <div className="sidebar-content">
        <div className="sidebar-toolbar">
          <div className="sidebar-filter">
            <TextField
              placeholder="Filter"
              aria-label="Filter connections"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Glyph name="search" size={15} />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </div>
          <div className="sidebar-tools">
            <IconButton
              aria-label="Add folder or connection"
              title="Add folder or connection"
              onClick={() => setAddTarget('root')}
            >
              <Glyph name="add" size={17} />
            </IconButton>
          </div>
        </div>
        <div
          ref={treeRef}
          className="sidebar-tree"
          role="tree"
          aria-label="Folders and connections"
          onDragOver={(event) => drag.over(event, null)}
          onDrop={(event) => drag.drop(event, null)}
        >
          <div className="sidebar-tree-content" style={{ width: contentWidth || '100%' }}>
            {foldersLoading || connectionsLoading ? (
              <div className="sidebar-loading">
                <CircularProgress size={20} />
              </div>
            ) : (
              <>
                {orderedItems(null, folders, matchingConnections, order).map((item) => {
                  if (item.kind === 'folder') {
                    const folder = folders.find((entry) => entry.id === item.id)
                    return folder ? (
                      <FolderBranch
                        key={itemKey(item)}
                        folder={folder}
                        folders={folders}
                        connections={matchingConnections}
                        order={order}
                        expanded={search ? {} : expanded}
                        activeFolderId={addTarget === 'root' ? null : (addTarget?.id ?? null)}
                        contentWidth={contentWidth}
                        onToggle={toggleFolder}
                        onOpenConnection={onOpenConnection}
                        onAddItem={setAddTarget}
                        onEditConnection={(entry) =>
                          setConnectionDialog({ connection: entry, parentId: entry.folderId })
                        }
                        onHostKey={setHostKeyConnection}
                        onNotice={onNotice}
                      />
                    ) : null
                  }
                  const connection = matchingConnections.find((entry) => entry.id === item.id)
                  return connection ? (
                    <ConnectionRow
                      key={itemKey(item)}
                      connection={connection}
                      contentWidth={contentWidth}
                      onOpen={onOpenConnection}
                      onEdit={(entry) =>
                        setConnectionDialog({ connection: entry, parentId: entry.folderId })
                      }
                      onHostKey={setHostKeyConnection}
                      onNotice={onNotice}
                    />
                  ) : null
                })}
                {drag.dragging && (
                  <div
                    className={`sidebar-root-drop ${drag.dropTarget?.edge === 'root' ? 'sidebar-root-active' : ''}`}
                    onDragOver={(event) => drag.over(event, null)}
                    onDrop={(event) => drag.drop(event, null)}
                  >
                    Move to root
                  </div>
                )}
                {folders.length === 0 && connections.length === 0 && (
                  <p className="sidebar-empty">Add a connection to get started.</p>
                )}
              </>
            )}
          </div>
        </div>
        <DialogPresence>
          {addTarget && (
            <AddItemDialog
              folderName={addTarget === 'root' ? 'root' : addTarget.name}
              onClose={() => setAddTarget(null)}
              onAddFolder={() => addInsideTarget('folder')}
              onAddConnection={() => addInsideTarget('connection')}
            />
          )}
        </DialogPresence>
        <DialogPresence>
          {folderDialog && (
            <FolderDialog parentId={folderDialog.parentId} onClose={() => setFolderDialog(null)} />
          )}
        </DialogPresence>
        <DialogPresence>
          {connectionDialog && (
            <ConnectionDialog
              connection={connectionDialog.connection}
              initialFolderId={connectionDialog.parentId}
              folders={folders}
              onClose={() => setConnectionDialog(null)}
              onNotice={onNotice}
            />
          )}
        </DialogPresence>
        <DialogPresence>
          {hostKeyConnection && (
            <HostKeyDialog
              connection={hostKeyConnection}
              onClose={() => setHostKeyConnection(null)}
            />
          )}
        </DialogPresence>
      </div>
    </SidebarDragContext.Provider>
  )
}
