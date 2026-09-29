import type { Connection, Folder } from '../../types'

export type SidebarKind = 'folder' | 'connection'

export interface SidebarItem {
  kind: SidebarKind
  id: string
  parentId: string | null
}

export type SidebarOrder = Record<string, string[]>
export type DropEdge = 'before' | 'after' | 'inside' | 'root'

export function itemKey(item: Pick<SidebarItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`
}

function parentKey(parentId: string | null): string {
  return parentId ?? 'root'
}

export function orderedItems(
  parentId: string | null,
  folders: Folder[],
  connections: Connection[],
  order: SidebarOrder,
): SidebarItem[] {
  const items: SidebarItem[] = [
    ...folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => ({ kind: 'folder' as const, id: folder.id, parentId })),
    ...connections
      .filter((connection) => connection.folderId === parentId)
      .map((connection) => ({ kind: 'connection' as const, id: connection.id, parentId })),
  ]
  const saved = order[parentKey(parentId)] ?? []
  const positions = new Map(saved.map((key, index) => [key, index]))
  return items.sort((left, right) => {
    const leftPosition = positions.get(itemKey(left)) ?? Number.MAX_SAFE_INTEGER
    const rightPosition = positions.get(itemKey(right)) ?? Number.MAX_SAFE_INTEGER
    return leftPosition - rightPosition
  })
}

export function moveItem(
  order: SidebarOrder,
  folders: Folder[],
  connections: Connection[],
  source: SidebarItem,
  target: SidebarItem | null,
  edge: DropEdge,
): SidebarOrder {
  const sourceKey = itemKey(source)
  const destinationParent = edge === 'inside' ? (target?.id ?? null) : (target?.parentId ?? null)
  const sourceParentKey = parentKey(source.parentId)
  const destinationParentKey = parentKey(destinationParent)
  const originalSource = orderedItems(source.parentId, folders, connections, order).map(itemKey)
  const originalDestination = orderedItems(destinationParent, folders, connections, order).map(
    itemKey,
  )
  const sourceItems = originalSource.filter((key) => key !== sourceKey)
  const destinationItems = (
    sourceParentKey === destinationParentKey ? sourceItems : originalDestination
  ).filter((key) => key !== sourceKey)
  const targetKey = target ? itemKey(target) : null
  const targetIndex = targetKey ? destinationItems.indexOf(targetKey) : -1
  const insertAt =
    targetIndex < 0 ? destinationItems.length : targetIndex + (edge === 'after' ? 1 : 0)
  destinationItems.splice(insertAt, 0, sourceKey)
  return {
    ...order,
    [sourceParentKey]: sourceParentKey === destinationParentKey ? destinationItems : sourceItems,
    [destinationParentKey]: destinationItems,
  }
}

export function isFolderCycle(
  source: SidebarItem,
  destinationParent: string | null,
  folders: Folder[],
): boolean {
  if (source.kind !== 'folder') return false
  let current = destinationParent
  while (current) {
    if (current === source.id) return true
    current = folders.find((folder) => folder.id === current)?.parentId ?? null
  }
  return false
}

export function loadSidebarOrder(userId: string): SidebarOrder {
  try {
    const value = localStorage.getItem(`lightremote.sidebarOrder.${userId}`)
    return value ? (JSON.parse(value) as SidebarOrder) : {}
  } catch {
    return {}
  }
}

export function saveSidebarOrder(userId: string, order: SidebarOrder): void {
  try {
    localStorage.setItem(`lightremote.sidebarOrder.${userId}`, JSON.stringify(order))
  } catch {
    // Dragging still works for this page when storage is unavailable.
  }
}
