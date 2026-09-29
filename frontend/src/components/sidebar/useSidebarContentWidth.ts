import { useEffect, useRef, useState } from 'react'
import type { Connection, Folder } from '../../types'
import { sidebarIndentPixels } from './sidebarDimensions'

// Measured labels need room for their icon, padding, and visible mobile actions.
const desktopRowChromePixels = 32
const mobileRowChromePixels = 84
const desktopFallbackCharacterPixels = 7
const mobileFallbackCharacterPixels = 9

/** Measures the visible tree so short names do not create a horizontal scrollbar. */
function measureContentWidth(
  folders: Folder[],
  connections: Connection[],
  expanded: Record<string, boolean>,
  search: string,
  mobile: boolean,
): number {
  const context = document.createElement('canvas').getContext('2d')
  if (context) context.font = mobile ? '15px Roboto' : '12px Roboto'
  const rowChromePixels = mobile ? mobileRowChromePixels : desktopRowChromePixels
  const fallbackCharacterPixels = mobile
    ? mobileFallbackCharacterPixels
    : desktopFallbackCharacterPixels

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
      const mobile = window.matchMedia('(max-width: 760px)').matches
      tree.style.setProperty('--sidebar-viewport-width', `${viewportWidth}px`)
      setContentWidth(
        Math.max(
          viewportWidth,
          measureContentWidth(folders, connections, expanded, search, mobile),
        ),
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
    window.addEventListener('resize', schedule)
    syncScroll()
    schedule()
    void document.fonts.ready.then(schedule)

    return () => {
      disposed = true
      observer.disconnect()
      tree.removeEventListener('scroll', syncScroll)
      window.removeEventListener('resize', schedule)
      window.cancelAnimationFrame(frame)
    }
  }, [folders, connections, expanded, search])

  return { treeRef, contentWidth }
}
