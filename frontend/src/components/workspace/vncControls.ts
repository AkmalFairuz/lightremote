/** Actions exposed by a mounted VNC viewer to the focused status bar. */
export interface VncControls {
  connected: boolean
  filesOpen: boolean
  localCursor: boolean
  sendCtrlAltDel: () => void
  takeScreenshot: () => void
  toggleFiles: () => void
  toggleLocalCursor: () => void
}
