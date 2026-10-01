const storageKey = 'lightremote.auth'
const unauthorizedEvent = 'lightremote.unauthorized'

interface SessionCredential {
  token: string
  expiresAt: string
}

function readCredential(): SessionCredential | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as SessionCredential | null
    if (
      value &&
      typeof value.token === 'string' &&
      /^[A-Za-z0-9_-]+$/.test(value.token) &&
      typeof value.expiresAt === 'string' &&
      Date.parse(value.expiresAt) > Date.now()
    ) {
      return { token: value.token, expiresAt: value.expiresAt }
    }
    localStorage.removeItem(storageKey)
  } catch {
    // Storage may be unavailable or contain malformed data.
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Continue with an in-memory session when storage is blocked.
    }
  }
  return null
}

let credential = readCredential()

export function sessionToken(): string | null {
  return credential?.token ?? null
}

export function saveSession(value: SessionCredential | null): void {
  credential = value
  try {
    if (value) localStorage.setItem(storageKey, JSON.stringify(value))
    else localStorage.removeItem(storageKey)
  } catch {
    // A successful login remains usable for this page when storage is blocked.
  }
}

export function authHeaders(csrfToken?: string | null): Headers {
  const headers = new Headers()
  const token = sessionToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  return headers
}

export function handleUnauthorized(status: number, requestToken: string | null): void {
  if (status === 401 && requestToken && requestToken === sessionToken()) {
    window.dispatchEvent(new Event(unauthorizedEvent))
  }
}

export async function authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = sessionToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers, credentials: 'omit' })
  handleUnauthorized(response.status, token)
  return response
}

export function watchSession(onUnauthorized: () => void, onChanged: () => void): void {
  window.addEventListener(unauthorizedEvent, onUnauthorized)
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage || (event.key !== storageKey && event.key !== null))
      return
    const previousToken = sessionToken()
    credential = readCredential()
    if (previousToken !== sessionToken()) onChanged()
  })
}
