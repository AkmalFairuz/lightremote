import { t } from '../../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { files } from '../../api/files'
import type { ConnectionKind, FileEntry } from '../../types'
import { normalizeRemotePath, normalizeVncEntry } from '../../utils/remoteFilePath'

interface RemoteDirectoryOptions {
  connectionId: string
  kind: ConnectionKind
  active: boolean
  initialPath?: string
  onPathChange?: (path: string) => void
}

function displayEntries(kind: ConnectionKind, entries: FileEntry[]): FileEntry[] {
  return kind === 'vnc' ? entries.map(normalizeVncEntry) : entries
}

/** Keeps directory navigation, cache reads, and in-flight responses together. */
export function useRemoteDirectory({
  connectionId,
  kind,
  active,
  initialPath,
  onPathChange,
}: RemoteDirectoryOptions) {
  const [path, setPath] = useState<string | null>(() => {
    if (initialPath) return normalizeRemotePath(kind, initialPath) ?? initialPath
    return kind === 'sftp' ? null : '/'
  })
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const onPathChangeRef = useRef(onPathChange)

  useEffect(() => {
    onPathChangeRef.current = onPathChange
  }, [onPathChange])

  const changePath = useCallback((value: string) => {
    // Invalidate responses started for the previous directory.
    requestSequence.current += 1
    setPath(value)
    setError(null)
    onPathChangeRef.current?.(value)
  }, [])

  const load = useCallback(
    async (refresh = false) => {
      if (path === null) return
      const sequence = ++requestSequence.current
      if (!refresh) {
        const cached = files.cachedList(connectionId, path)
        if (cached) {
          const displayed = displayEntries(kind, cached)
          setEntries(displayed)
          setLoadedPath(path)
          setError(null)
          setLoading(false)
          return displayed
        }
      }

      setLoading(true)
      setError(null)
      try {
        const result = await files.list(connectionId, path)
        if (sequence !== requestSequence.current) return
        const displayed = displayEntries(kind, result)
        setEntries(displayed)
        setLoadedPath(path)
        return displayed
      } catch (cause) {
        if (sequence !== requestSequence.current) return
        setError(cause instanceof Error ? cause.message : t('files.couldNotListRemoteFiles'))
      } finally {
        if (sequence === requestSequence.current) setLoading(false)
      }
    },
    [connectionId, kind, path],
  )

  useEffect(() => {
    if (!active) return
    if (path === null) {
      let cancelled = false
      void files.home(connectionId).then(
        (result) => {
          if (!cancelled) changePath(result.path)
        },
        (cause) => {
          if (!cancelled)
            setError(
              cause instanceof Error
                ? cause.message
                : t('files.couldNotFindTheRemoteHomeDirectory'),
            )
        },
      )
      return () => {
        cancelled = true
      }
    }

    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [active, changePath, connectionId, load, path])

  return { path, entries, loadedPath, loading, error, setError, changePath, load }
}
