declare module '@novnc/novnc' {
  export default class RFB {
    constructor(target: HTMLElement, url: string | WebSocket)
    scaleViewport: boolean
    resizeSession: boolean
    background: string
    showDotCursor: boolean
    viewOnly: boolean
    addEventListener(type: string, listener: (event: Event) => void): void
    disconnect(): void
    sendCtrlAltDel(): void
    toBlob(callback: BlobCallback, type?: string, quality?: number): void
  }
}
