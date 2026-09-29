import { useEffect, useRef, useState } from 'react'
import type { Connection, Folder } from '../../types'
import { sidebarIndentPixels } from './sidebarDimensions'

// Measured labels still need room for their chevron or icon and row padding.
const rowChromePixels = 32
const fallbackCharacterPixels = 7

/** Measures the visible tree so short names do not create a horizontal scrollbar. */
function measureContentWidth(
  folders: Folder[],
  connections: Connection[],
  expanded: Record<string, boolean>,
  search: string,
): number {
  const context = document.createElement('canvas').getContext('2d')
  if (context) context.font = '12px Roboto'

  const foldersByParent = new Map<string | null, Folder[]>()
  const connectionsByParent = new Map<string | null, Connection[]>()
  for (const folder of folders) {
    const siblings = foldersByParent.get(folder.parentId) ?? []
    siblings.push(folder)
    foldersByParent.set(folder.parentId, siblings)
  }
  for (const connection of connections) {
    const siblings = connectionsByParent.get(connection.folderId) ?? []
    siblings.push(connection)
    connectionsByParent.set(connection.folderId, siblings)
  }

  let widest = 0
  const textWidth = (name: string) =>
    context?.measureText(name).width ?? name.length * fallbackCharacterPixels

  function visit(parentId: string | null, depth: number) {
    for (const folder of foldersByParent.get(parentId) ?? []) {
      widest = Math.max(
        widest,
        depth * sidebarIndentPixels + textWidth(folder.name) + rowChromePixels,
      )
      if (search || expanded[folder.id] !== false) {
        visit(folder.id, depth + 1)
      }
    }
    for (const connection of connectionsByParent.get(parentId) ?? []) {
      widest = Math.max(
        widest,
        depth * sidebarIndentPixels + textWidth(connection.name) + rowChromePixels,
      )
    }
  }

  visit(null, 0)
  return Math.ceil(widest)
}

/** Tracks the sidebar viewport and visible names for one shared horizontal scroll width. */
export function useSidebarContentWidth(
  folders: Folder[],
  connections: Connection[],
  expanded: Record<string, boolean>,
  search: string,
) {
  const treeRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)

  useEffect(() => {
    const tree = treeRef.current
    if (!tree) return
    let disposed = false
    let frame = 0

    const measure = () => {
      if (disposed) return
      const viewportWidth = tree.clientWidth
      tree.style.setProperty('--sidebar-viewport-width', `${viewportWidth}px`)
      setContentWidth(
        Math.max(viewportWidth, measureContentWidth(folders, connections, expanded, search)),
      )
    }
    const syncScroll = () => {
      tree.style.setProperty('--sidebar-scroll-left', `${tree.scrollLeft}px`)
    }
    const schedule = () => {
      if (disposed) return
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measure)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(tree)
    tree.addEventListener('scroll', syncScroll, { passive: true })
    syncScroll()
    schedule()
    void document.fonts.ready.then(schedule)

    return () => {
      disposed = true
      observer.disconnect()
      tree.removeEventListener('scroll', syncScroll)
      window.cancelAnimationFrame(frame)
    }
  }, [folders, connections, expanded, search])

  return { treeRef, contentWidth }
}
