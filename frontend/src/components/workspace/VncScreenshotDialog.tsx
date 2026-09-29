import { useEffect, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '../../ui'
import { Notice } from '../common/Notice'
import { Glyph } from '../common/Glyph'
import { saveImageFile } from '../../desktop/actions'
import { isDesktop } from '../../desktop/viewerSocket'
import { errorMessage } from '../../types'

interface VncScreenshotDialogProps {
  blob: Blob
  filename: string
  imageUrl: string
  onClose: () => void
}

/** Previews a native-resolution VNC capture and offers copy or download. */
export function VncScreenshotDialog({
  blob,
  filename,
  imageUrl,
  onClose,
}: VncScreenshotDialogProps) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  async function copyImage() {
    setError(null)
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      setError('This browser cannot copy images to the clipboard.')
      return
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied(true)
    } catch {
      setError('Could not copy the screenshot. Check clipboard permission and try again.')
    }
  }

  async function downloadImage() {
    if (isDesktop) {
      try {
        const dataURL = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        await saveImageFile(filename, dataURL.slice(dataURL.indexOf(',') + 1))
      } catch (cause) {
        setError(errorMessage(cause))
      }
      return
    }
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = filename
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Screenshot captured</DialogTitle>
      <DialogContent className="vnc-screenshot-content">
        <Notice message={error} />
        <div className="vnc-screenshot-preview">
          <img src={imageUrl} alt="Captured VNC desktop" />
        </div>
      </DialogContent>
      <DialogActions>
        <Button
          startIcon={<Glyph name="content-copy" size={17} />}
          onClick={() => void copyImage()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          variant="contained"
          startIcon={<Glyph name="download" size={17} />}
          onClick={() => void downloadImage()}
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  )
}
