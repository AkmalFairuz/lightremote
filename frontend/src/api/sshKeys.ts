import { authenticatedFetch, authHeaders } from './authSession'
import {
  errorMessage,
  type GeneratedSSHKey,
  type SSHKey,
  type SSHKeyAlgorithm,
  type SSHKeyInput,
} from '../types'

interface GenerateSSHKeyInput {
  name: string
  algorithm: SSHKeyAlgorithm
  passphrase: string
}

// Keep private key material out of Redux while generating and optionally saving it.
async function postSSHKey<Result>(
  path: string,
  body: unknown,
  csrfToken: string | null,
): Promise<Result> {
  const headers = authHeaders(csrfToken)
  headers.set('Content-Type', 'application/json')
  const response = await authenticatedFetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(errorMessage({ data: result }))
  }
  return result as Result
}

export function generateSSHKey(
  input: GenerateSSHKeyInput,
  csrfToken: string | null,
): Promise<GeneratedSSHKey> {
  return postSSHKey('/api/ssh-keys/generate', input, csrfToken)
}

export function storeSSHKey(input: SSHKeyInput, csrfToken: string | null): Promise<SSHKey> {
  return postSSHKey('/api/ssh-keys', input, csrfToken)
}
