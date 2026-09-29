import { useRef, type FormEvent } from 'react'
import { Button, IconButton, Tooltip } from '../../ui'
import { Glyph } from '../common/Glyph'

interface FileToolbarProps {
  path: string | null
  pathPlaceholder?: string
  busy: boolean
  writeDisabled?: boolean
  onParent: () => void
  onNavigate: (path: string) => void
  onRefresh: () => void
  onNewFolder: () => void
  onUpload: (files: FileList) => void
}

export function FileToolbar({
  path,
  pathPlaceholder = '/remote/path',
  busy,
  writeDisabled = false,
  onParent,
  onNavigate,
  onRefresh,
  onNewFolder,
  onUpload,
}: FileToolbarProps) {
  const uploadInput = useRef<HTMLInputElement>(null)

  function navigate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('path')
    if (typeof value === 'string') onNavigate(value)
  }

  return (
    <div className="files-toolbar">
      <form className="files-path" onSubmit={navigate}>
        <IconButton
          aria-label="Parent folder"
          disabled={path === null || path === '/'}
          onClick={onParent}
        >
          <Glyph name="arrow-upward" size={17} />
        </IconButton>
        <input
          key={path ?? 'pending'}
          name="path"
          aria-label="Remote path"
          defaultValue={path ?? ''}
          placeholder={path === null ? 'Finding home…' : pathPlaceholder}
        />
      </form>
      <div className="files-actions">
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh files" disabled={path === null} onClick={onRefresh}>
            <Glyph name="refresh" size={18} />
          </IconButton>
        </Tooltip>
        <Button
          onClick={onNewFolder}
          disabled={busy || path === null || writeDisabled}
          startIcon={<Glyph name="create-new-folder-outline" size={17} />}
        >
          New folder
        </Button>
        <Button
          onClick={() => uploadInput.current?.click()}
          disabled={busy || path === null || writeDisabled}
          startIcon={<Glyph name="upload-file-outline" size={17} />}
        >
          Upload
        </Button>
        <input
          ref={uploadInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) onUpload(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
