import type { ConnectionKind, FileEntry } from '../types'

/** Returns the parent directory, including VNC's virtual drive root. */
export function parentRemotePath(value: string): string {
  if (value === '/' || /^[A-Za-z]:\/$/.test(value)) return '/'
  const separator = value.lastIndexOf('/')
  if (/^[A-Za-z]:\//.test(value) && separator === 2) return `${value.slice(0, 2)}/`
  return value.slice(0, separator) || '/'
}

/** Appends a remote entry without doubling the slash after a drive letter. */
export function joinRemotePath(directory: string, name: string): string {
  return `${directory.endsWith('/') ? directory : `${directory}/`}${name}`
}

/** Identifies a Windows drive root such as C:/. */
export function isDriveRoot(value: string): boolean {
  return /^\/?[A-Za-z]:\/?$/.test(value)
}

/** Accepts a drive path in the VNC browser and POSIX paths elsewhere. */
export function normalizeRemotePath(kind: ConnectionKind, value: string): string | null {
  if (kind !== 'vnc') return value.startsWith('/') ? value : null
  if (value === '/') return value
  const drivePath = value
    .replaceAll('\0', '')
    .replaceAll('\\', '/')
    .replace(/^\/(?=[A-Za-z]:)/, '')
  if (/^[A-Za-z]:$/.test(drivePath)) return `${drivePath}/`
  return /^[A-Za-z]:\//.test(drivePath) ? drivePath : null
}

/** Normalizes legacy VNC entries cached before NUL terminators were decoded. */
export function normalizeVncEntry(entry: FileEntry): FileEntry {
  const name = entry.name.replaceAll('\0', '')
  const rawPath = entry.path.replaceAll('\0', '')
  const path = normalizeRemotePath('vnc', rawPath) ?? rawPath
  return name === entry.name && path === entry.path ? entry : { ...entry, name, path }
}
