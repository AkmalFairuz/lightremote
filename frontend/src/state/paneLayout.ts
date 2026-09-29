import { maxPaneRatio, minPaneRatio } from './workspaceLimits'

export type PaneEdge = 'left' | 'right' | 'top' | 'bottom'

export type PaneNode =
  | { type: 'pane'; id: string; tabId: string | null }
  | {
      type: 'split'
      id: string
      direction: 'row' | 'column'
      ratio: number
      first: PaneNode
      second: PaneNode
    }

export interface PaneRect {
  paneId: string
  tabId: string | null
  left: number
  top: number
  width: number
  height: number
}

export interface DividerRect {
  id: string
  direction: 'row' | 'column'
  left: number
  top: number
  width: number
  height: number
  start: number
  extent: number
}

/** Finds a pane by ID or the pane displaying a tab. */
export function findPane(
  node: PaneNode,
  value: string,
  byTab = false,
): Extract<PaneNode, { type: 'pane' }> | null {
  if (node.type === 'pane') {
    const matches = byTab ? node.tabId === value : node.id === value
    return matches ? node : null
  }
  return findPane(node.first, value, byTab) ?? findPane(node.second, value, byTab)
}

/** Counts the visible slots in a pane tree. */
export function paneCount(node: PaneNode): number {
  return node.type === 'pane' ? 1 : paneCount(node.first) + paneCount(node.second)
}

/** Assigns a tab to one pane, removing it from its previous pane. */
export function assignPane(node: PaneNode, paneId: string, tabId: string): void {
  if (node.type === 'pane') {
    if (node.tabId === tabId) node.tabId = null
    if (node.id === paneId) node.tabId = tabId
    return
  }
  assignPane(node.first, paneId, tabId)
  assignPane(node.second, paneId, tabId)
}

/** Replaces a target leaf with a split containing a new tab. */
export function splitPane(
  node: PaneNode,
  paneId: string,
  tabId: string,
  edge: PaneEdge,
  splitId: string,
  newPaneId: string,
): PaneNode {
  if (node.type === 'pane') {
    if (node.id !== paneId) return node
    const incoming: PaneNode = { type: 'pane', id: newPaneId, tabId }
    const incomingFirst = edge === 'left' || edge === 'top'
    return {
      type: 'split',
      id: splitId,
      direction: edge === 'left' || edge === 'right' ? 'row' : 'column',
      ratio: 0.5,
      first: incomingFirst ? incoming : node,
      second: incomingFirst ? node : incoming,
    }
  }
  node.first = splitPane(node.first, paneId, tabId, edge, splitId, newPaneId)
  node.second = splitPane(node.second, paneId, tabId, edge, splitId, newPaneId)
  return node
}

/** Collapses a pane and promotes its sibling. */
export function removePane(node: PaneNode, paneId: string): PaneNode {
  if (node.type === 'pane') return node
  if (node.first.type === 'pane' && node.first.id === paneId) return node.second
  if (node.second.type === 'pane' && node.second.id === paneId) return node.first
  node.first = removePane(node.first, paneId)
  node.second = removePane(node.second, paneId)
  return node
}

/** Updates a divider while keeping both panes usable. */
export function resizePane(node: PaneNode, splitId: string, ratio: number): void {
  if (node.type === 'pane') return
  if (node.id === splitId) node.ratio = Math.max(minPaneRatio, Math.min(maxPaneRatio, ratio))
  else {
    resizePane(node.first, splitId, ratio)
    resizePane(node.second, splitId, ratio)
  }
}

/** Computes pane and divider positions as proportions of the workspace. */
export function paneGeometry(node: PaneNode): { panes: PaneRect[]; dividers: DividerRect[] } {
  const panes: PaneRect[] = []
  const dividers: DividerRect[] = []

  function visit(current: PaneNode, left: number, top: number, width: number, height: number) {
    if (current.type === 'pane') {
      panes.push({ paneId: current.id, tabId: current.tabId, left, top, width, height })
      return
    }
    if (current.direction === 'row') {
      const firstWidth = width * current.ratio
      visit(current.first, left, top, firstWidth, height)
      visit(current.second, left + firstWidth, top, width - firstWidth, height)
      dividers.push({
        id: current.id,
        direction: 'row',
        left: left + firstWidth,
        top,
        width: 0,
        height,
        start: left,
        extent: width,
      })
    } else {
      const firstHeight = height * current.ratio
      visit(current.first, left, top, width, firstHeight)
      visit(current.second, left, top + firstHeight, width, height - firstHeight)
      dividers.push({
        id: current.id,
        direction: 'column',
        left,
        top: top + firstHeight,
        width,
        height: 0,
        start: top,
        extent: height,
      })
    }
  }

  visit(node, 0, 0, 1, 1)
  return { panes, dividers }
}
