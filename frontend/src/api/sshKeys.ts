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
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
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
