import { useT } from '../../i18n/useT'
import { nameCollator } from '../../i18n/format'
import { useLocale } from '../../i18n/useLocale'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useConnectionsQuery } from '../../api/resources'
import type { Connection } from '../../types'
import { Dialog, DialogContent, IconButton, InputAdornment, TextField } from '../../ui'
import { Glyph } from '../common/Glyph'

interface OpenConnectionDialogProps {
  onClose: () => void
  onOpen: (connection: Connection) => void
}

const kindIcons = {
  ssh: 'terminal',
  vnc: 'desktop-windows-outline',
  sftp: 'folder-shared-outline',
  ftp: 'folder-outline',
}

/** Finds saved connections without depending on the sidebar's current filter or expanded folders. */
export function OpenConnectionDialog({ onClose, onOpen }: OpenConnectionDialogProps) {
  const t = useT()

  const locale = useLocale()

  const { data: connections, isLoading, isError } = useConnectionsQuery()
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)
  const matches = useMemo(() => {
    const collator = nameCollator('base', locale)
    const query = search.trim().toLowerCase()
    return (connections ?? [])
      .filter((connection) =>
        `${connection.name} ${connection.host} ${connection.kind} ${connection.username}`
          .toLowerCase()
          .includes(query),
      )
      .sort(
        (left, right) =>
          collator.compare(left.name, right.name) || collator.compare(left.host, right.host),
      )
  }, [connections, search, locale])
  const selectedIndex = Math.min(highlightedIndex, matches.length - 1)

  useEffect(() => {
    if (selectedIndex < 0) return
    resultsRef.current?.children.item(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, matches])

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) =>
        matches.length > 0 ? Math.min(current + 1, matches.length - 1) : 0,
      )
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault()
      onOpen(matches[selectedIndex])
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      className="open-connection-dialog"
      aria-labelledby="open-connection-title"
      maxWidth="sm"
      fullWidth
    >
      <span id="open-connection-title" className="open-connection-accessible-label">
        {t('shell.openConnection')}
      </span>
      <DialogContent className="open-connection-content">
        <div className="open-connection-search-row">
          <TextField
            autoFocus
            placeholder={t('shell.searchConnections')}
            aria-label={t('shell.searchConnections')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setHighlightedIndex(0)
            }}
            onKeyDown={handleSearchKeyDown}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Glyph name="search" size={21} />
                  </InputAdornment>
                ),
              },
              htmlInput: {
                role: 'combobox',
                'aria-autocomplete': 'list',
                'aria-expanded': true,
                'aria-controls': 'open-connection-results',
                'aria-activedescendant':
                  selectedIndex >= 0
                    ? `open-connection-result-${matches[selectedIndex].id}`
                    : undefined,
              },
            }}
          />
          <IconButton aria-label={t('shell.closeOpenConnectionDialog')} onClick={onClose}>
            <Glyph name="close" size={20} />
          </IconButton>
        </div>
        <div
          id="open-connection-results"
          ref={resultsRef}
          className="open-connection-results"
          role="listbox"
          aria-label="Connections"
        >
          {isLoading ? (
            <p className="open-connection-message">{t('shell.loadingConnections')}</p>
          ) : isError ? (
            <p className="open-connection-message">{t('shell.couldNotLoadConnections')}</p>
          ) : matches.length === 0 ? (
            <p className="open-connection-message">
              {search.trim() ? t('shell.noMatchingConnections') : t('shell.noSavedConnections')}
            </p>
          ) : (
            matches.map((connection, index) => (
              <button
                key={connection.id}
                id={`open-connection-result-${connection.id}`}
                type="button"
                className={`open-connection-result ${index === selectedIndex ? 'open-connection-result-selected' : ''}`}
                role="option"
                aria-selected={index === selectedIndex}
                tabIndex={-1}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onOpen(connection)}
              >
                <Glyph name={kindIcons[connection.kind]} size={22} />
                <span className="open-connection-result-details">
                  <strong>{connection.name}</strong>
                  <small>
                    {connection.host} · {connection.kind.toUpperCase()}
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
