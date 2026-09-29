import { useState, type DragEvent } from 'react'
import { useMoveConnectionFolderMutation, useUpdateFolderMutation } from '../../api/resources'
import { useAppSelector } from '../../state/hooks'
import { errorMessage, type Connection, type Folder } from '../../types'
import type { SidebarDragValue, SidebarDropTarget } from './SidebarDragContext'
import {
  isFolderCycle,
  itemKey,
  loadSidebarOrder,
  moveItem,
  saveSidebarOrder,
  type DropEdge,
  type SidebarItem,
  type SidebarOrder,
} from './sidebarOrder'

const folderInsideDropStart = 0.28
const folderInsideDropEnd = 0.72
const rowMidpoint = 0.5

export function useSidebarDnD(
  folders: Folder[],
  connections: Connection[],
  onNotice: (message: string) => void,
  onExpandFolder: (id: string) => void,
): { order: SidebarOrder; drag: SidebarDragValue } {
  const userId = useAppSelector((state) => state.auth.user?.id ?? '')
  const [updateFolder] = useUpdateFolderMutation()
  const [moveConnectionFolder] = useMoveConnectionFolderMutation()
  const [order, setOrder] = useState<SidebarOrder>(() => loadSidebarOrder(userId))
  const [dragging, setDragging] = useState<SidebarItem | null>(null)
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null)

  function edgeFor(event: DragEvent<HTMLDivElement>, item: SidebarItem | null): DropEdge {
    if (!item) return 'root'
    const bounds = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientY - bounds.top) / bounds.height
    // The center nests inside a folder; its edges reorder beside it.
    if (
      item.kind === 'folder' &&
      fraction > folderInsideDropStart &&
      fraction < folderInsideDropEnd
    ) {
      return 'inside'
    }
    return fraction < rowMidpoint ? 'before' : 'after'
  }

  function destinationParent(item: SidebarItem | null, edge: DropEdge): string | null {
    return edge === 'inside' ? (item?.id ?? null) : (item?.parentId ?? null)
  }

  function canDrop(source: SidebarItem, target: SidebarItem | null, edge: DropEdge): boolean {
    if (target && itemKey(source) === itemKey(target)) return false
    return !isFolderCycle(source, destinationParent(target, edge), folders)
  }

  function start(event: DragEvent<HTMLDivElement>, item: SidebarItem) {
    event.stopPropagation()
    event.dataTransfer.setData('application/x-lightremote-sidebar', itemKey(item))
    event.dataTransfer.setData('text/plain', itemKey(item))
    event.dataTransfer.effectAllowed = 'move'
    setDragging(item)
  }

  function over(event: DragEvent<HTMLDivElement>, item: SidebarItem | null) {
    event.stopPropagation()
    if (!dragging) return
    const edge = edgeFor(event, item)
    if (!canDrop(dragging, item, edge)) {
      setDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget({ item, edge })
  }

  async function commitDrop(source: SidebarItem, target: SidebarItem | null, edge: DropEdge) {
    const parentId = destinationParent(target, edge)
    if (parentId !== source.parentId) {
      if (source.kind === 'folder') {
        const folder = folders.find((entry) => entry.id === source.id)
        if (!folder) return
        await updateFolder({ id: folder.id, name: folder.name, parentId }).unwrap()
      } else {
        await moveConnectionFolder({ id: source.id, folderId: parentId }).unwrap()
      }
    }
    const next = moveItem(order, folders, connections, source, target, edge)
    setOrder(next)
    saveSidebarOrder(userId, next)
    if (edge === 'inside' && target) onExpandFolder(target.id)
  }

  function drop(event: DragEvent<HTMLDivElement>, item: SidebarItem | null) {
    event.stopPropagation()
    const source = dragging
    const edge = edgeFor(event, item)
    setDragging(null)
    setDropTarget(null)
    if (
      !source ||
      event.dataTransfer.getData('application/x-lightremote-sidebar') !== itemKey(source)
    )
      return
    if (!canDrop(source, item, edge)) return
    event.preventDefault()
    void commitDrop(source, item, edge).catch((error) => onNotice(errorMessage(error)))
  }

  return {
    order,
    drag: {
      dragging,
      dropTarget,
      start,
      over,
      drop,
      end: () => {
        setDragging(null)
        setDropTarget(null)
      },
    },
  }
}
