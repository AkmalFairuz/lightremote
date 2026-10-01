import { sessionToken } from '../api/authSession'
import type { WailsSocket } from '@wailsio/runtime'
import { desktopRuntime, isDesktop } from './runtime'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const frameBinary = 0
const frameText = 1
const frameClose = 2

export { isDesktop }

/** Keeps browser WebSockets and Wails streams behind the same viewer interface. */
export function openViewerSocket(kind: 'ssh' | 'vnc', sessionId: string): WebSocket {
  if (isDesktop) return new DesktopViewerSocket(kind, sessionId) as unknown as WebSocket
  const url = new URL(`/api/sessions/${sessionId}/ws`, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = sessionToken()
  return new WebSocket(url, token ? ['lightremote', `lightremote.auth.${token}`] : [])
}

class DesktopViewerSocket extends EventTarget {
  readonly CONNECTING = WebSocket.CONNECTING
  readonly OPEN = WebSocket.OPEN
  readonly CLOSING = WebSocket.CLOSING
  readonly CLOSED = WebSocket.CLOSED
  readonly protocol = ''
  readonly extensions = ''
  readonly url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private readonly stream: WailsSocket | WebSocket
  private attached = false
  private closeReason = ''

  constructor(kind: 'ssh' | 'vnc', sessionId: string) {
    super()
    this.url = `wails-stream:${kind}/${sessionId}`
    if (!desktopRuntime) throw new Error('Wails runtime is unavailable.')
    this.stream = desktopRuntime.Stream(kind)
    this.stream.binaryType = 'arraybuffer'
    this.stream.addEventListener('open', () => {
      this.stream.send(JSON.stringify({ sessionId }))
    })
    this.stream.addEventListener('message', (event) => {
      const bytes = new Uint8Array((event as MessageEvent<ArrayBuffer>).data)
      if (bytes.length === 0) return
      const payload = bytes.subarray(1)
      if (!this.attached) {
        if (bytes[0] !== frameText || decoder.decode(payload) !== '{"type":"attached"}') {
          this.closeReason = 'Could not attach to the work session.'
          this.stream.close()
          return
        }
        this.attached = true
        this.emit(new Event('open'), this.onopen)
        return
      }
      if (bytes[0] === frameClose) {
        this.closeReason = decoder.decode(payload)
        this.stream.close()
      } else if (bytes[0] === frameText) {
        this.emit(new MessageEvent('message', { data: decoder.decode(payload) }), this.onmessage)
      } else if (bytes[0] === frameBinary) {
        this.emit(new MessageEvent('message', { data: payload.slice().buffer }), this.onmessage)
      }
    })
    this.stream.addEventListener('close', (event) => {
      const reason = this.closeReason || (event as CloseEvent).reason
      this.emit(new CloseEvent('close', { reason }), this.onclose)
    })
    this.stream.addEventListener('error', () => {
      this.emit(new Event('error'), this.onerror)
    })
  }

  get binaryType(): BinaryType {
    return this.stream.binaryType
  }

  set binaryType(value: BinaryType) {
    this.stream.binaryType = value
  }

  get readyState(): number {
    if (!this.attached && this.stream.readyState === WebSocket.OPEN) {
      return WebSocket.CONNECTING
    }
    return this.stream.readyState
  }

  get bufferedAmount(): number {
    return this.stream.bufferedAmount
  }

  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void {
    if (!this.attached) throw new DOMException('Viewer is still connecting.', 'InvalidStateError')
    const header = typeof data === 'string' ? frameText : frameBinary
    if (data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => this.send(buffer))
      return
    }
    let payload: Uint8Array
    if (typeof data === 'string') {
      payload = encoder.encode(data)
    } else if (ArrayBuffer.isView(data)) {
      payload = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    } else {
      payload = new Uint8Array(data)
    }
    const frame = new Uint8Array(payload.byteLength + 1)
    frame[0] = header
    frame.set(payload, 1)
    this.stream.send(frame)
  }

  close(code?: number, reason?: string): void {
    this.stream.close(code, reason)
  }

  private emit<T extends Event>(event: T, handler: ((event: T) => void) | null): void {
    handler?.(event)
    this.dispatchEvent(event)
  }
}
