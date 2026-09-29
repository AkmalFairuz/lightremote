import { useState } from 'react'
import { Collapse } from '@mui/material'
import { Dialog, DialogContent, DialogTitle } from '../../ui'
import type { Folder } from '../../types'
import { Glyph } from '../common/Glyph'
import { folderExpandDurationMs } from './sidebarDimensions'

interface FolderPickerDialogProps {
  folders: Folder[]
  selectedId: string
  onSelect: (id: string) => void
  onClose: () => void
}

interface FolderPickerBranchProps {
  folder?: Folder
  folders: Folder[]
  selectedId: string
  expanded: Record<string, boolean>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}

function initiallyExpanded(folders: Folder[], selectedId: string): Record<string, boolean> {
  const expanded: Record<string, boolean> = { '': true }
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const visited = new Set<string>()
  let current = byId.get(selectedId)

  while (current && !visited.has(current.id)) {
    expanded[current.id] = true
    visited.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return expanded
}

function FolderPickerBranch({
  folder,
  folders,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: FolderPickerBranchProps) {
  const id = folder?.id ?? ''
  const name = folder?.name ?? 'Root'
  const open = Boolean(expanded[id])
  const selected = selectedId === id
  const children = folders
    .filter((entry) => entry.parentId === (folder?.id ?? null))
    .sort((left, right) => left.name.localeCompare(right.name))

  return (
    <div className="folder-picker-branch" role="treeitem" aria-expanded={open}>
      <div className={`folder-picker-row ${selected ? 'folder-picker-selected' : ''}`}>
        <button
          type="button"
          className="folder-picker-toggle"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
          aria-expanded={open}
          onClick={() => onToggle(id)}
        >
          <span className={`folder-picker-chevron ${open ? 'folder-picker-chevron-open' : ''}`}>
            <Glyph name="keyboard-arrow-right" size={17} />
          </span>
        </button>
        <button
          type="button"
          className="folder-picker-choice"
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(id)}
        >
          {name}
        </button>
      </div>
      <Collapse
        in={open}
        timeout={folderExpandDurationMs}
        unmountOnExit
        className="folder-picker-children-collapse"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="folder-picker-children" role="group">
          {children.map((child) => (
            <FolderPickerBranch
              key={child.id}
              folder={child}
              folders={folders}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      </Collapse>
    </div>
  )
}

/** Selects the root or one nested connection folder. */
export function FolderPickerDialog({
  folders,
  selectedId,
  onSelect,
  onClose,
}: FolderPickerDialogProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    initiallyExpanded(folders, selectedId),
  )

  function toggle(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth initialFocus="dialog">
      <DialogTitle>Choose folder</DialogTitle>
      <DialogContent className="folder-picker-content">
        <div role="tree" aria-label="Choose connection folder">
          <FolderPickerBranch
            folders={folders}
            selectedId={selectedId}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
