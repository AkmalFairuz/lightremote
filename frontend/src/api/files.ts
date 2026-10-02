import { localizedApiMessage } from '../i18n/errors'
import { t } from '../i18n'
import { authenticatedFetch, authHeaders, handleUnauthorized, sessionToken } from './authSession'
import { store } from '../state/store'
import { isDesktop } from '../desktop/runtime'
import type { FileEntry } from '../types'
import { parentRemotePath } from '../utils/remoteFilePath'

const maxCachedPaths = 100
const oversizedEditorMessage = 'Files of 10 MB or larger cannot be edited in the browser.'
const directoryCache = new Map<string, FileEntry[]>()

function cacheKey(connectionId: string, path: string): string {
  const userId = store.getState().auth.user?.id ?? ''
  return JSON.stringify([userId, connectionId, path])
}

function cachedList(connectionId: string, path: string): FileEntry[] | null {
  const key = cacheKey(connectionId, path)
  const entries = directoryCache.get(key)
  if (!entries) return null
  // Reinsert hits so the first map key is always the least recently used path.
  directoryCache.delete(key)
  directoryCache.set(key, entries)
  return entries
}

function rememberList(connectionId: string, path: string, entries: FileEntry[]): void {
  const key = cacheKey(connectionId, path)
  directoryCache.delete(key)
  directoryCache.set(key, entries)
  if (directoryCache.size > maxCachedPaths) {
    const oldest = directoryCache.keys().next().value
    if (oldest) directoryCache.delete(oldest)
  }
}

function invalidatePaths(connectionId: string, paths: string[], subtrees: string[] = []): void {
  const userId = store.getState().auth.user?.id ?? ''
  for (const key of directoryCache.keys()) {
    const [cachedUser, cachedConnection, cachedPath] = JSON.parse(key) as string[]
    if (cachedUser !== userId || cachedConnection !== connectionId) continue
    if (
      paths.includes(cachedPath) ||
      subtrees.some(
        (path) =>
          cachedPath === path || cachedPath.startsWith(path.endsWith('/') ? path : `${path}/`),
      )
    ) {
      directoryCache.delete(key)
    }
  }
}

function fileURL(connectionId: string, suffix: string, path?: string): string {
  const base = `/api/connections/${encodeURIComponent(connectionId)}/files${suffix}`
  return path === undefined ? base : `${base}?${new URLSearchParams({ path })}`
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string }
  } | null
  return new Error(
    body?.error
      ? localizedApiMessage(body.error.code, body.error.message)
      : t('files.requestFailed', { status: response.status }),
  )
}

type TransferProgress = (loaded: number, total: number) => void

async function uploadFile(url: string, file: File, onProgress?: TransferProgress): Promise<void> {
  // WebKit custom-scheme requests can lose File/Blob bodies. Materialize the
  // bytes for the desktop asset server; browsers can stream the original File.
  const body = isDesktop ? await file.arrayBuffer() : file
  const transferId = crypto.randomUUID()
  const separator = url.includes('?') ? '&' : '?'
  const progressURL =
    url.replace('/upload?', '/upload/progress?') + `${separator}transfer=${transferId}`
  const uploadURL = url + `${separator}transfer=${transferId}`
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let reported = 0

  async function pollProgress() {
    try {
      const response = await authenticatedFetch(progressURL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (response.ok) {
        const progress = (await response.json()) as { loaded: number }
        if (!controller.signal.aborted && progress.loaded > reported) {
          reported = Math.min(progress.loaded, file.size)
          onProgress?.(reported, file.size)
        }
      }
    } catch {
      // A failed progress request must not interrupt the file transfer.
    }
    if (!controller.signal.aborted) timer = setTimeout(() => void pollProgress(), 150)
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('PUT', uploadURL)
      const requestToken = sessionToken()
      request.setRequestHeader('Content-Type', 'application/octet-stream')
      request.setRequestHeader('X-Upload-Size', String(file.size))
      authHeaders(store.getState().auth.csrfToken).forEach((value, name) => {
        request.setRequestHeader(name, value)
      })

      request.onload = () => {
        handleUnauthorized(request.status, requestToken)
        if (request.status >= 200 && request.status < 300) {
          onProgress?.(file.size, file.size)
          resolve()
          return
        }
        let message = t('files.requestFailed', { status: request.status })
        try {
          const body = JSON.parse(request.responseText) as {
            error?: { code?: string; message?: string }
          }
          message = body.error ? localizedApiMessage(body.error.code, body.error.message) : message
        } catch {
          // Use the HTTP status when the server did not return JSON.
        }
        reject(new Error(message))
      }
      request.onerror = () => reject(new Error(t('files.couldNotReachTheServer')))
      request.onabort = () => reject(new Error(t('files.uploadWasCanceled')))
      onProgress?.(0, file.size)
      request.send(body)
      if (onProgress) void pollProgress()
    })
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}

async function downloadFile(
  id: string,
  path: string,
  filename: string,
  expectedSize: number,
  onProgress?: TransferProgress,
): Promise<void> {
  const response = await authenticatedFetch(fileURL(id, '/download', path))
  if (!response.ok) throw await responseError(response)
  if (!response.body) throw new Error(t('files.theRemoteFileCouldNotBeRead'))

  const length = Number(response.headers.get('Content-Length'))
  const total = length > 0 ? length : expectedSize
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const reader = response.body.getReader()
  let loaded = 0
  onProgress?.(0, total)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(new Uint8Array(value))
      loaded += value.byteLength
      onProgress?.(loaded, total)
    }
  } finally {
    reader.releaseLock()
  }

  const objectURL = URL.createObjectURL(new Blob(chunks))
  const link = document.createElement('a')
  link.href = objectURL
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 60_000)
}

async function fileRequest<T>(
  url: string,
  method = 'GET',
  body?: BodyInit,
  json = false,
): Promise<T> {
  const headers = authHeaders(method === 'GET' ? null : store.getState().auth.csrfToken)
  if (json) headers.set('Content-Type', 'application/json')
  const response = await authenticatedFetch(url, { method, headers, body })
  if (!response.ok) {
    throw await responseError(response)
  }
  if (response.status === 204) return undefined as T
  if (response.headers.get('Content-Type')?.includes('application/json')) {
    return response.json() as Promise<T>
  }
  return response.blob() as Promise<T>
}

/** Reads a small UTF-8 file without allowing an oversized response into memory. */
async function readText(id: string, path: string, maxBytes: number): Promise<string> {
  const response = await authenticatedFetch(fileURL(id, '/download', path))
  if (!response.ok) {
    throw await responseError(response)
  }

  const length = Number(response.headers.get('Content-Length'))
  if (length >= maxBytes) {
    await response.body?.cancel()
    throw new Error(oversizedEditorMessage)
  }

  const chunks: Uint8Array[] = []
  let total = 0
  if (!response.body) throw new Error(t('files.theRemoteFileCouldNotBeRead'))
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total >= maxBytes) {
        await reader.cancel()
        throw new Error(oversizedEditorMessage)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const contents = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    contents.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contents)
    if (decoded.includes('\0')) {
      throw new Error(t('files.thisFileContainsBinaryDataAndCannotBeEdited'))
    }
    return decoded
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(t('files.thisFileIsNotValidUtf8Text'), { cause: error })
    }
    throw error
  }
}

export const files = {
  home: (id: string) => fileRequest<{ path: string }>(fileURL(id, '/home')),
  cachedList,
  clearCache: () => directoryCache.clear(),
  list: async (id: string, path: string) => {
    const entries = await fileRequest<FileEntry[]>(fileURL(id, '', path))
    rememberList(id, path, entries)
    return entries
  },
  download: downloadFile,
  readText,
  writeText: async (id: string, path: string, contents: string, maxBytes: number) => {
    const encoded = new TextEncoder().encode(contents)
    if (encoded.byteLength >= maxBytes) {
      throw new Error(oversizedEditorMessage)
    }
    await fileRequest<void>(fileURL(id, '/upload', path), 'PUT', encoded)
    invalidatePaths(id, [parentRemotePath(path)])
  },
  upload: async (id: string, path: string, file: File, onProgress?: TransferProgress) => {
    await uploadFile(fileURL(id, '/upload', path), file, onProgress)
    invalidatePaths(id, [parentRemotePath(path)])
  },
  mkdir: async (id: string, path: string) => {
    await fileRequest<void>(fileURL(id, '/mkdir'), 'POST', JSON.stringify({ path }), true)
    invalidatePaths(id, [parentRemotePath(path)])
  },
  rename: async (id: string, oldPath: string, newPath: string) => {
    await fileRequest<void>(
      fileURL(id, '/rename'),
      'POST',
      JSON.stringify({ oldPath, newPath }),
      true,
    )
    invalidatePaths(id, [parentRemotePath(oldPath), parentRemotePath(newPath)], [oldPath, newPath])
  },
  delete: async (id: string, path: string) => {
    await fileRequest<void>(fileURL(id, '', path), 'DELETE')
    invalidatePaths(id, [parentRemotePath(path)], [path])
  },
}
