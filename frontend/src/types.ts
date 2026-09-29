export type ConnectionKind = 'ssh' | 'vnc' | 'sftp' | 'ftp'
export type AuthType = 'none' | 'password' | 'private_key'
export type VncEncoding = 'auto' | 'copyrect' | 'tight' | 'zlib' | 'hextile' | 'zrle' | 'raw'

export interface User {
  id: string
  email: string
  role: 'admin' | 'user'
  disabled: boolean
  createdAt: string
}

export interface LoginResult {
  user: User
  csrfToken: string
  localMode: boolean
}

export interface Folder {
  id: string
  parentId: string | null
  name: string
  createdAt: string
}

export interface ProxyInput {
  type: 'http' | 'https' | 'socks5'
  host: string
  port: number
  username: string
  password?: string
}

export interface Proxy extends Omit<ProxyInput, 'password'> {
  hasPassword: boolean
}

export interface ConnectionInput {
  folderId: string | null
  name: string
  kind: ConnectionKind
  host: string
  port: number
  username: string
  authType: AuthType
  ftpTls?: boolean
  vncEncoding?: VncEncoding
  vncReadOnly?: boolean
  vncFileTransfer?: boolean
  secret?: { password?: string; privateKey?: string; passphrase?: string }
  proxy?: ProxyInput | null
}

export interface Connection extends Omit<ConnectionInput, 'secret' | 'proxy'> {
  id: string
  vncReadOnly: boolean
  vncFileTransfer: boolean
  proxy: Proxy | null
  hostKeyFingerprint: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkSession {
  id: string
  connectionId: string
  kind: 'ssh' | 'vnc'
  createdAt: string
}

export interface Metrics {
  bytesReceived: number
  bytesSent: number
  lastActivity: string
}

export interface SessionDetail {
  session: WorkSession
  metrics: Metrics
}

export interface FileEntry {
  name: string
  path: string
  size: number
  isDir: boolean
  modTime: string
}

export interface ApiError {
  status?: number
  data?: { error?: { code?: string; message?: string } }
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  const apiError = error as ApiError | undefined
  return apiError?.data?.error?.message ?? 'The request could not be completed.'
}
