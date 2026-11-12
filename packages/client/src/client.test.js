import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from './index.js'

// A fake Tylix backend. `session.access` stands in for the access-token
// cookie and `session.refresh` for the refresh-token cookie.
function fakeServer() {
  const session = { access: false, refresh: false }
  const calls = []
  const user = { id: 1, name: 'Ada', email: 'ada@example.com' }

  const json = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  async function fetch(url, init = {}) {
    const path = new URL(url, 'http://x').pathname
    calls.push({ path, method: init.method, credentials: init.credentials, body: init.body })
    // Let concurrent requests interleave like real network calls.
    await new Promise((r) => setTimeout(r, 1))

    switch (`${init.method} ${path}`) {
      case 'POST /api/login': {
        const { email, password } = JSON.parse(init.body)
        if (email !== user.email || password !== 'secret123') {
          return json(401, { error: 'Invalid email or password.' })
        }
        session.access = true
        session.refresh = true
        return json(200, { user })
      }
      case 'POST /api/register':
        return json(422, { errors: { email: ['This email is already registered.'] } })
      case 'POST /api/auth/refresh':
        if (!session.refresh) return json(401, { error: 'No refresh token provided.' })
        session.access = true
        return json(200, { ok: true })
      case 'POST /api/auth/logout':
        session.access = false
        session.refresh = false
        return new Response(null, { status: 204 })
      case 'GET /api/me':
        return session.access ? json(200, user) : json(401, { error: 'Not authenticated.' })
      case 'GET /api/posts':
        return session.access ? json(200, [{ id: 1 }]) : json(401, { error: 'Not authenticated.' })
      case 'POST /api/posts':
        return session.access ? json(201, JSON.parse(init.body)) : json(401, { error: 'Not authenticated.' })
      default:
        return json(404, { error: 'Not found' })
    }
  }

  return { fetch, session, calls, user }
}

const count = (calls, path) => calls.filter((c) => c.path === path).length

test('returns the useApi result shape and always sends cookies', async () => {
  const server = fakeServer()
  server.session.access = true
  const { api } = createClient({ fetch: server.fetch, channel: null })

  const result = await api('/api/posts')
  assert.deepEqual(result, { ok: true, status: 200, data: [{ id: 1 }], error: null, errors: null })
  assert.equal(server.calls[0].credentials, 'include')
})

test('sends objects as JSON and exposes 422 field errors', async () => {
  const server = fakeServer()
  const { auth } = createClient({ fetch: server.fetch, channel: null })

  const result = await auth.register({ name: 'A', email: 'ada@example.com', password: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 422)
  assert.deepEqual(result.errors, { email: ['This email is already registered.'] })
  assert.equal(result.error, 'This email is already registered.')
  assert.equal(server.calls[0].body, JSON.stringify({ name: 'A', email: 'ada@example.com', password: 'x' }))
})

test('resetPassword sends the email, token and new password together', async () => {
  const server = fakeServer()
  const { auth } = createClient({ fetch: server.fetch, channel: null })

  await auth.resetPassword({ email: 'ada@example.com', token: 't0k', password: 'n3w-password' })
  const call = server.calls.find((c) => c.path === '/api/auth/reset-password')
  assert.deepEqual(JSON.parse(call.body), { email: 'ada@example.com', token: 't0k', password: 'n3w-password' })
})

test('init checks /api/me once, however many callers ask', async () => {
  const server = fakeServer()
  server.session.access = true
  const { auth } = createClient({ fetch: server.fetch, channel: null })

  assert.equal(auth.getState().status, 'loading')
  await Promise.all([auth.init(), auth.init(), auth.init()])
  assert.equal(count(server.calls, '/api/me'), 1)
  assert.deepEqual(auth.getState(), { status: 'authenticated', user: server.user })
})

test('init with no session ends as guest without looping on refresh', async () => {
  const server = fakeServer()
  const { auth } = createClient({ fetch: server.fetch, channel: null })

  await auth.init()
  // A first visit is a plain guest, not an "expired" session.
  assert.deepEqual(auth.getState(), { status: 'guest', user: null })
  assert.equal(count(server.calls, '/api/me'), 1)
  assert.equal(count(server.calls, '/api/auth/refresh'), 1)
})

test('an expired access token is refreshed and the request replayed', async () => {
  const server = fakeServer()
  const { api, auth } = createClient({ fetch: server.fetch, channel: null })
  await auth.login('ada@example.com', 'secret123')

  server.session.access = false // access cookie expired, refresh still valid
  const result = await api.post('/api/posts', { title: 'Hi' })

  assert.equal(result.ok, true)
  assert.equal(result.status, 201)
  assert.deepEqual(result.data, { title: 'Hi' })
  assert.equal(count(server.calls, '/api/auth/refresh'), 1)
  assert.equal(count(server.calls, '/api/posts'), 2)
  assert.equal(auth.getState().status, 'authenticated')
})

test('concurrent 401s share one refresh call', async () => {
  const server = fakeServer()
  const { api, auth } = createClient({ fetch: server.fetch, channel: null })
  await auth.login('ada@example.com', 'secret123')

  server.session.access = false
  const results = await Promise.all([api('/api/posts'), api('/api/posts'), api('/api/me')])

  assert.ok(results.every((r) => r.ok))
  assert.equal(count(server.calls, '/api/auth/refresh'), 1)
})

test('a failed refresh ends the session as expired', async () => {
  const server = fakeServer()
  const { api, auth } = createClient({ fetch: server.fetch, channel: null })
  await auth.login('ada@example.com', 'secret123')

  server.session.access = false
  server.session.refresh = false
  const result = await api('/api/posts')

  assert.equal(result.status, 401)
  assert.deepEqual(auth.getState(), { status: 'guest', user: null, expired: true })
})

test('a wrong password is a 401 that never triggers a refresh', async () => {
  const server = fakeServer()
  const { auth } = createClient({ fetch: server.fetch, channel: null })

  const result = await auth.login('ada@example.com', 'wrong')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'Invalid email or password.')
  assert.equal(count(server.calls, '/api/auth/refresh'), 0)
  assert.equal(auth.getState().status, 'loading')
})

test('logout clears the session and notifies subscribers', async () => {
  const server = fakeServer()
  const { auth } = createClient({ fetch: server.fetch, channel: null })
  await auth.login('ada@example.com', 'secret123')

  const seen = []
  const unsubscribe = auth.subscribe((s) => seen.push(s.status))
  await auth.logout()
  unsubscribe()

  assert.deepEqual(seen, ['guest'])
  assert.equal(server.session.refresh, false)
})

test('state objects are replaced, never mutated', async () => {
  const server = fakeServer()
  server.session.access = true
  const { auth } = createClient({ fetch: server.fetch, channel: null })

  const before = auth.getState()
  assert.equal(auth.getState(), before, 'same snapshot between changes')
  await auth.init()
  assert.notEqual(auth.getState(), before)
  assert.equal(before.status, 'loading')
})

test('a session injected by the server skips /api/me', async () => {
  const server = fakeServer()
  globalThis.__TYLIX_SESSION__ = { user: server.user }
  try {
    const { auth } = createClient({ fetch: server.fetch, channel: null })
    await auth.init()
    assert.equal(auth.getState().status, 'authenticated')
    assert.equal(server.calls.length, 0)
  } finally {
    delete globalThis.__TYLIX_SESSION__
  }
})

test('an injected guest session starts as guest at once, then checks in the background', async () => {
  const server = fakeServer()
  // Access cookie expired, refresh cookie still valid.
  server.session.refresh = true
  globalThis.__TYLIX_SESSION__ = { user: null }
  try {
    const { auth } = createClient({ fetch: server.fetch, channel: null })
    const pending = auth.init()
    assert.deepEqual(auth.getState(), { status: 'guest', user: null }, 'synchronous, for hydration')
    await pending
    assert.equal(auth.getState().status, 'authenticated', 'the refresh brought the session back')
    assert.equal(count(server.calls, '/api/auth/refresh'), 1)
  } finally {
    delete globalThis.__TYLIX_SESSION__
  }
})

test('logout in another tab logs this tab out; login there re-checks', async () => {
  const server = fakeServer()
  const tabA = new BroadcastChannel('tylix:auth:test')
  const tabB = new BroadcastChannel('tylix:auth:test')
  try {
    const a = createClient({ fetch: server.fetch, channel: tabA })
    const b = createClient({ fetch: server.fetch, channel: tabB })

    await a.auth.login('ada@example.com', 'secret123')
    await waitFor(() => b.auth.getState().status === 'authenticated')

    await a.auth.logout()
    await waitFor(() => b.auth.getState().status === 'guest')
  } finally {
    tabA.close()
    tabB.close()
  }
})

test('network failures resolve to status 0 instead of throwing', async () => {
  const { api } = createClient({
    fetch: async () => {
      throw new TypeError('fetch failed')
    },
    channel: null,
  })
  const warn = console.warn
  console.warn = () => {}
  try {
    const result = await api('/api/posts')
    assert.equal(result.ok, false)
    assert.equal(result.status, 0)
    assert.equal(result.error, 'fetch failed')
  } finally {
    console.warn = warn
  }
})

async function waitFor(check, timeoutMs = 1000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}
