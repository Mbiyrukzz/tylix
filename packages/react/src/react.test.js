import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// A browser-like global environment before React loads.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The shared client instance calls globalThis.fetch, so the fake backend
// goes there. `session.access` stands in for the access-token cookie.
const session = { access: false, refresh: false }
const user = { id: 7, name: 'Grace', email: 'grace@example.com' }
let postsCalls = 0
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url, 'http://x').pathname
  switch (`${init.method} ${path}`) {
    case 'GET /api/me':
      return session.access ? json(200, user) : json(401, { error: 'Not authenticated.' })
    case 'POST /api/login':
      session.access = true
      session.refresh = true
      return json(200, { user })
    case 'POST /api/auth/refresh':
      return session.refresh ? ((session.access = true), json(200, { ok: true })) : json(401, {})
    case 'POST /api/auth/logout':
      session.access = false
      session.refresh = false
      return new Response(null, { status: 204 })
    case 'GET /api/posts':
      postsCalls++
      return json(200, [{ id: 1, title: 'First' }])
    default:
      return json(404, { error: 'Not found' })
  }
}

const { createElement: h, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useAuth, RequireAuth, GuestOnly, useApi, useChannel, auth } = await import('./index.js')
const { installFakeWebSocket } = await import('../../client/src/fakeWebSocket.js')

let root
before(() => {
  root = createRoot(document.getElementById('root'))
})
after(() => {
  act(() => root.unmount())
  dom.window.close()
})

const text = () => document.getElementById('root').textContent

async function render(element) {
  await act(async () => {
    root.render(element)
  })
}

async function settle() {
  // Let pending fetches resolve and React flush.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
  }
}

function Status() {
  const { status, user } = useAuth()
  return h('p', null, user ? `${status}:${user.name}` : status)
}

function App() {
  return h(
    'div',
    null,
    h(Status),
    h(RequireAuth, { fallback: h('span', null, '[login-redirect]'), loading: h('span', null, '[wait]') }, h('span', null, '[dashboard]')),
    h(GuestOnly, { fallback: h('span', null, '[go-dashboard]') }, h('span', null, '[login-form]')),
  )
}

test('starts loading, then shows guest views when there is no session', async () => {
  await render(h(App))
  // The very first render happens before /api/me answers.
  await settle()
  assert.equal(text(), 'guest[login-redirect][login-form]')
})

test('login switches every guard without a reload', async () => {
  await act(async () => {
    await auth.login('grace@example.com', 'secret123')
  })
  assert.equal(text(), 'authenticated:Grace[dashboard][go-dashboard]')
})

test('logout switches back', async () => {
  await act(async () => {
    await auth.logout()
  })
  assert.equal(text(), 'guest[login-redirect][login-form]')
})

function Posts({ url }) {
  const { loading, data, error } = useApi(url)
  if (loading) return h('p', null, 'loading')
  if (error) return h('p', null, `error:${error}`)
  if (!data) return h('p', null, 'idle')
  return h('ul', null, data.map((p) => h('li', { key: p.id }, p.title)))
}

test('useApi loads data and exposes it', async () => {
  await render(h(Posts, { url: '/api/posts' }))
  await settle()
  assert.equal(text(), 'First')
})

test('useApi with a null url does not fetch', async () => {
  const before = postsCalls
  await render(h(Posts, { url: null }))
  await settle()
  assert.equal(text(), 'idle')
  assert.equal(postsCalls, before)
})

test('useApi reports HTTP errors', async () => {
  await render(h(Posts, { url: '/api/missing' }))
  await settle()
  assert.equal(text(), 'error:Not found')
})

test('useChannel connects once mounted, delivers messages, sends, and closes on unmount', async () => {
  const fake = installFakeWebSocket()
  const seen = []
  let api
  function Chat() {
    api = useChannel('chat', (message) => seen.push(message))
    return h('p', null, `channel:${api.status}`)
  }
  try {
    await render(h(Chat))
    await settle()
    assert.equal(text(), 'channel:open')
    assert.equal(fake.sockets.length, 1)
    assert.match(fake.sockets[0].url, /\/chat$/)
    await act(async () => api.send({ text: 'hi' }))
    assert.deepEqual(fake.sockets[0].sent, [{ text: 'hi' }])
    await act(async () => fake.sockets[0].receive({ text: 'yo' }))
    assert.deepEqual(seen, [{ text: 'yo' }])
    await render(h('p', null, 'gone'))
    assert.equal(fake.sockets[0].readyState, 3)
  } finally {
    fake.restore()
  }
})
