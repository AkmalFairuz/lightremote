import { createContext, useContext, type DragEvent } from 'react'
import type { DropEdge, SidebarItem } from './sidebarOrder'

export interface SidebarDropTarget {
  item: SidebarItem | null
  edge: DropEdge
}

export interface SidebarDragValue {
  dragging: SidebarItem | null
  dropTarget: SidebarDropTarget | null
  start: (event: DragEvent<HTMLDivElement>, item: SidebarItem) => void
  over: (event: DragEvent<HTMLDivElement>, item: SidebarItem | null) => void
  drop: (event: DragEvent<HTMLDivElement>, item: SidebarItem | null) => void
  end: () => void
}

export const SidebarDragContext = createContext<SidebarDragValue | null>(null)

export function useSidebarDrag(): SidebarDragValue {
  const value = useContext(SidebarDragContext)
  if (!value) throw new Error('Sidebar drag context is missing')
  return value
}
