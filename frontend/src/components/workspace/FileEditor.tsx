import { t as translate } from '../../i18n'
import { useT } from '../../i18n/useT'
import { translateMessage } from '../../i18n'
import { useLocale } from '../../i18n/useLocale'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { Button, CircularProgress, DialogPresence } from '../../ui'
import { files } from '../../api/files'
import type { FileEntry } from '../../types'
import { formatBytes } from '../../utils/formatBytes'
import { ConfirmDialog } from '../common/ActionDialogs'
import { Glyph } from '../common/Glyph'
import { maxEditableBytes } from './editableFile'

interface FileEditorProps {
  connectionId: string
  entry: FileEntry
  onBack: () => void
  onSaved: () => Promise<void>
}

/** Loads and saves a small UTF-8 remote file. */
export function FileEditor({ connectionId, entry, onBack, onSaved }: FileEditorProps) {
  const t = useT()

  const locale = useLocale()

  const [original, setOriginal] = useState('')
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const dirty = value !== original

  useEffect(() => {
    let cancelled = false
    void files.readText(connectionId, entry.path, maxEditableBytes).then(
      (contents) => {
        if (cancelled) return
        setOriginal(contents)
        setValue(contents)
        setLoading(false)
      },
      (cause) => {
        if (cancelled) return
        setError(
          cause instanceof Error ? cause.message : translate('files.couldNotOpenTheRemoteFile'),
        )
        setLoadFailed(true)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [connectionId, entry.path])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await files.writeText(connectionId, entry.path, value, maxEditableBytes)
      setOriginal(value)
      setSaved(true)
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('files.couldNotSaveTheRemoteFile'))
    } finally {
      setSaving(false)
    }
  }

  function back() {
    if (dirty) {
      setConfirmLeave(true)
      return
    }
    onBack()
  }

  function editorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (!saving && dirty) void save()
    }
  }

  return (
    <div className="file-editor">
      <div className="file-editor-toolbar">
        <Button onClick={back} disabled={saving} startIcon={<Glyph name="arrow-back" size={17} />}>
          {t('connections.back')}
        </Button>
        <span className="file-editor-path" title={entry.path}>
          {entry.path}
        </span>
        <span className="file-editor-size">{formatBytes(entry.size, locale)}</span>
        <Button
          variant="contained"
          disabled={loading || saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? t('files.saving') : t('users.save')}
        </Button>
      </div>
      {error && (
        <div className="files-error" role="alert">
          {translateMessage(error, locale)}
        </div>
      )}
      {saved && !error && (
        <div className="file-editor-saved" role="status">
          {t('files.saved')}
        </div>
      )}
      {loading ? (
        <div className="files-loading">
          <CircularProgress size={22} />
          <span>{t('files.openingFile')}</span>
        </div>
      ) : (
        <textarea
          className="file-editor-input"
          aria-label={t('common.editNamed', { name: entry.name })}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setSaved(false)
          }}
          onKeyDown={editorKeyDown}
          disabled={saving || loadFailed}
          spellCheck={false}
        />
      )}
      <DialogPresence>
        {confirmLeave && (
          <ConfirmDialog
            title={t('files.discardUnsavedChanges')}
            message={t('files.unsaved', { name: entry.name })}
            actionLabel={t('files.discard')}
            onClose={() => setConfirmLeave(false)}
            onConfirm={async () => onBack()}
          />
        )}
      </DialogPresence>
    </div>
  )
}
