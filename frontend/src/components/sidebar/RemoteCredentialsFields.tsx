import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Button, IconButton, PasswordField } from '../../ui'
import type { AuthType } from '../../types'
import { Glyph } from '../common/Glyph'

const maxPrivateKeyBytes = 512 * 1024

interface RemoteCredentialsFieldsProps {
  authType: AuthType
  editing: boolean
  password: string
  privateKeyFileName: string | null
  passphrase: string
  onPassword: (value: string) => void
  onPrivateKey: (value: string) => void
  onPrivateKeyFileName: (name: string | null) => void
  onPassphrase: (value: string) => void
}

export function RemoteCredentialsFields(props: RemoteCredentialsFieldsProps) {
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
      setFileError('Choose a nonempty private key file no larger than 512 KiB.')
      return
    }

    try {
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      )
      if (sequence !== readSequence.current) return
      if (!content) {
        setFileError('The private key file is empty.')
        return
      }
      props.onPrivateKey(content)
      props.onPrivateKeyFileName(file.name)
    } catch {
      if (sequence === readSequence.current) {
        setFileError('Could not read this file as a UTF-8 private key.')
      }
    }
  }

  /** Accepts file drags while leaving other pointer interactions alone. */
  function hasDraggedFiles(event: DragEvent<HTMLDivElement>): boolean {
    return event.dataTransfer.types.includes('Files')
  }

  if (props.authType === 'password') {
    return (
      <PasswordField
        label="Remote password"
        value={props.password}
        onChange={(event) => props.onPassword(event.target.value)}
        required={!props.editing}
        autoComplete="new-password"
        helperText={props.editing ? 'Leave blank to keep the saved password.' : undefined}
      />
    )
  }

  if (props.authType === 'private_key') {
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
              setFileError('Drop one private key file at a time.')
              return
            }
            const selected = event.dataTransfer.files[0]
            if (selected) void loadPrivateKey(selected)
          }}
        >
          <div className="private-key-file-actions">
            <span>Private key file{props.editing ? '' : ' *'}</span>
            <Button
              type="button"
              variant="outlined"
              onClick={() => fileInput.current?.click()}
              startIcon={<Glyph name="upload-file-outline" size={16} />}
            >
              Choose file
            </Button>
            <input
              ref={fileInput}
              type="file"
              aria-label="Choose SSH private key file"
              hidden
              onChange={(event) => {
                const selected = event.target.files?.[0]
                if (selected) void loadPrivateKey(selected)
                event.target.value = ''
              }}
            />
          </div>
          <small className="private-key-drop-hint">Drop a PEM or OpenSSH key file here.</small>
          {props.privateKeyFileName && (
            <div className="private-key-loaded-row">
              <small className="private-key-loaded">Loaded {props.privateKeyFileName}</small>
              <IconButton
                type="button"
                aria-label="Remove selected private key file"
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
          label="Key passphrase"
          value={props.passphrase}
          onChange={(event) => props.onPassphrase(event.target.value)}
          autoComplete="new-password"
        />
      </>
    )
  }

  return null
}
