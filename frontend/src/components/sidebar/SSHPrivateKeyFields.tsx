import { useT } from '../../i18n/useT'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Button, IconButton, PasswordField } from '../../ui'
import { Glyph } from '../common/Glyph'

const maxPrivateKeyBytes = 512 * 1024

interface SSHPrivateKeyFieldsProps {
  privateKeyFileName: string | null
  passphrase: string
  onPrivateKey: (value: string) => void
  onPrivateKeyFileName: (name: string | null) => void
  onPassphrase: (value: string) => void
}

export function SSHPrivateKeyFields(props: SSHPrivateKeyFieldsProps) {
  const t = useT()

  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const readSequence = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      readSequence.current += 1
    }
  }, [])

  /** Loads a selected SSH private key without showing its contents in the field. */
  async function loadPrivateKey(file: File) {
    const sequence = ++readSequence.current
    setFileError(null)

    if (file.size === 0 || file.size > maxPrivateKeyBytes) {
      setFileError(t('connections.chooseANonemptyPrivateKeyFileNoLargerThan512Kib'))
      return
    }

    try {
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      )
      if (sequence !== readSequence.current) return
      if (!content) {
        setFileError(t('connections.thePrivateKeyFileIsEmpty'))
        return
      }
      props.onPrivateKey(content)
      props.onPrivateKeyFileName(file.name)
    } catch {
      if (sequence === readSequence.current) {
        setFileError(t('connections.couldNotReadThisFileAsAUtf8PrivateKey'))
      }
    }
  }

  /** Accepts file drags while leaving other pointer interactions alone. */
  function hasDraggedFiles(event: DragEvent<HTMLDivElement>): boolean {
    return event.dataTransfer.types.includes('Files')
  }

  return (
    <>
      <div
        className={`private-key-drop-target ${dragActive ? 'private-key-drop-active' : ''}`}
        onDragEnter={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          dragDepth.current += 1
          setDragActive(true)
        }}
        onDragOver={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (!hasDraggedFiles(event)) return
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragActive(false)
        }}
        onDrop={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          dragDepth.current = 0
          setDragActive(false)
          if (event.dataTransfer.files.length !== 1) {
            setFileError(t('connections.dropOnePrivateKeyFileAtATime'))
            return
          }
          const selected = event.dataTransfer.files[0]
          if (selected) void loadPrivateKey(selected)
        }}
      >
        <div className="private-key-file-actions">
          <span>{t('connections.privateKeyFile')}</span>
          <Button
            type="button"
            variant="outlined"
            onClick={() => fileInput.current?.click()}
            startIcon={<Glyph name="upload-file-outline" size={16} />}
          >
            {t('connections.chooseFile')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            aria-label={t('connections.chooseSshPrivateKeyFile')}
            hidden
            onChange={(event) => {
              const selected = event.target.files?.[0]
              if (selected) void loadPrivateKey(selected)
              event.target.value = ''
            }}
          />
        </div>
        <small className="private-key-drop-hint">
          {t('connections.dropAPemOrOpensshKeyFileHere')}
        </small>
        {props.privateKeyFileName && (
          <div className="private-key-loaded-row">
            <small className="private-key-loaded">
              {t('connections.loaded')} {props.privateKeyFileName}
            </small>
            <IconButton
              type="button"
              aria-label={t('connections.removeSelectedPrivateKeyFile')}
              onClick={() => {
                readSequence.current += 1
                props.onPrivateKey('')
                props.onPrivateKeyFileName(null)
                setFileError(null)
              }}
            >
              <Glyph name="close" size={16} />
            </IconButton>
          </div>
        )}
        {fileError && (
          <small className="private-key-error" role="alert">
            {fileError}
          </small>
        )}
      </div>
      <PasswordField
        label={t('connections.keyPassphrase')}
        value={props.passphrase}
        onChange={(event) => props.onPassphrase(event.target.value)}
        autoComplete="new-password"
      />
    </>
  )
}
