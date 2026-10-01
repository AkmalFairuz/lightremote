import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/api/authSession.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText
let moduleId = 0
const key = 'lightremote.auth'
const valid = (token = 'session-token') => ({
  token,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
})

async function load(t, stored = null, blocked = false) {
  const original = {
    localStorage: globalThis.localStorage,
    window: globalThis.window,
    fetch: globalThis.fetch,
  }
  const values = new Map(stored === null ? [] : [[key, stored]])
  globalThis.localStorage = {
    getItem: (name) => {
      if (blocked) throw new Error('blocked')
      return values.get(name) ?? null
    },
    setItem: (name, value) => {
      if (blocked) throw new Error('blocked')
      values.set(name, value)
    },
    removeItem: (name) => {
      if (blocked) throw new Error('blocked')
      values.delete(name)
    },
  }
  globalThis.window = new EventTarget()
  t.after(() => Object.assign(globalThis, original))
  const session = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${moduleId++}`
  )
  return { session, values }
}

test('restore only valid, unexpired credentials and persist only credential fields', async (t) => {
  const credential = valid()
  const { session, values } = await load(
    t,
    JSON.stringify({ ...credential, user: { id: 'private' } }),
  )
  assert.equal(session.sessionToken(), credential.token)
  session.saveSession(credential)
  assert.deepEqual(JSON.parse(values.get(key)), credential)
  session.saveSession(null)
  assert.equal(session.sessionToken(), null)
  assert.equal(values.has(key), false)
})

for (const stored of [
  '{broken',
  JSON.stringify({ token: 'expired', expiresAt: '2000-01-01' }),
  JSON.stringify({ token: 'bad token', expiresAt: valid().expiresAt }),
]) {
  test(`discard invalid storage: ${stored}`, async (t) => {
    const { session, values } = await load(t, stored)
    assert.equal(session.sessionToken(), null)
    assert.equal(values.has(key), false)
  })
}

test('blocked storage permits an in-memory login', async (t) => {
  const { session } = await load(t, null, true)
  session.saveSession(valid())
  assert.equal(session.sessionToken(), 'session-token')
  session.saveSession(null)
  assert.equal(session.sessionToken(), null)
})

test('HTTP requests carry bearer and CSRF headers, omit cookies, and clear current sessions on 401', async (t) => {
  const { session } = await load(t)
  session.saveSession(valid())
  let unauthorized = 0
  session.watchSession(
    () => {
      unauthorized++
      session.saveSession(null)
    },
    () => {},
  )
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/files')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.headers.get('Authorization'), 'Bearer session-token')
    assert.equal(init.headers.get('X-CSRF-Token'), 'csrf')
    return new Response('', { status: 401 })
  }
  await session.authenticatedFetch('/api/files', { headers: session.authHeaders('csrf') })
  assert.equal(unauthorized, 1)
  assert.equal(session.sessionToken(), null)
})

test('stale failures cannot clear a replacement login', async (t) => {
  const { session } = await load(t)
  session.saveSession(valid('old'))
  let finish
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  let unauthorized = 0
  session.watchSession(
    () => unauthorized++,
    () => {},
  )
  const pending = session.authenticatedFetch('/api/auth/me')
  session.saveSession(valid('new'))
  finish(new Response('', { status: 401 }))
  await pending
  session.handleUnauthorized(401, null)
  session.handleUnauthorized(403, 'new')
  assert.equal(unauthorized, 0)
  assert.equal(session.sessionToken(), 'new')
})

test('cross-tab login, logout, and clear synchronize credentials', async (t) => {
  const { session, values } = await load(t)
  let changed = 0
  session.watchSession(
    () => {},
    () => changed++,
  )
  const emit = (storageKey) => {
    const event = new Event('storage')
    Object.assign(event, { key: storageKey, storageArea: globalThis.localStorage })
    window.dispatchEvent(event)
  }
  values.set(key, JSON.stringify(valid('other-tab')))
  emit('unrelated')
  assert.equal(session.sessionToken(), null)
  emit(key)
  assert.equal(session.sessionToken(), 'other-tab')
  values.delete(key)
  emit(null)
  assert.equal(session.sessionToken(), null)
  assert.equal(changed, 2)
})
