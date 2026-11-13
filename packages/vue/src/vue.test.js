import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.SVGElement = dom.window.SVGElement
after(() => dom.window.close())

// Fake backend on globalThis.fetch, used by the shared client instance.
const session = { access: false }
const user = { id: 9, name: 'Evan', email: 'evan@example.com' }
let postsCalls = 0
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url, 'http://x').pathname
  await new Promise((r) => setTimeout(r, 1))
  switch (`${init.method} ${path}`) {
    case 'GET /api/me':
      return session.access ? json(200, user) : json(401, { error: 'Not authenticated.' })
    case 'POST /api/login':
      session.access = true
      return json(200, { user })
    case 'POST /api/auth/refresh':
      return json(401, {})
    case 'POST /api/auth/logout':
      session.access = false
      return new Response(null, { status: 204 })
    case 'GET /api/posts':
      postsCalls++
      return json(200, [{ id: 1, title: 'First' }])
    case 'GET /api/posts/2':
      return json(200, { id: 2, title: 'Second' })
    default:
      return json(404, { error: 'Not found' })
  }
}

const { createApp, h, nextTick, ref } = await import('vue')
const { installFakeWebSocket } = await import('../../client/src/fakeWebSocket.js')
const { useAuth, useApi, sessionReady, auth, ErrorBoundary } = await import('./index.js')

const settle = async () => {
  await new Promise((r) => setTimeout(r, 20))
  await nextTick()
}

function mount(setup) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({ setup })
  app.mount(el)
  return { el, unmount: () => app.unmount() }
}

test('useAuth follows the session: loading, guest, authenticated, guest', async () => {
  const view = mount(() => {
    const { status, user } = useAuth()
    return () => h('p', user.value ? `${status.value}:${user.value.name}` : status.value)
  })
  assert.equal(view.el.textContent, 'loading')
  // Wait for the condition, not a fixed time: the check is two requests.
  await waitFor(() => view.el.textContent === 'guest')

  await auth.login('evan@example.com', 'x')
  await nextTick()
  assert.equal(view.el.textContent, 'authenticated:Evan')

  await auth.logout()
  await nextTick()
  assert.equal(view.el.textContent, 'guest')
  view.unmount()
})

test('sessionReady resolves after the first check (for router guards)', async () => {
  await sessionReady()
  assert.notEqual(auth.getState().status, 'loading')
})

test('useApi loads data and reloads on demand', async () => {
  const before = postsCalls
  let api
  const view = mount(() => {
    api = useApi('/api/posts')
    return () => h('p', api.loading.value ? 'loading' : api.data.value.map((p) => p.title).join(','))
  })
  assert.equal(view.el.textContent, 'loading')
  await settle()
  assert.equal(view.el.textContent, 'First')
  assert.equal(api.status.value, 200)
  await api.reload()
  assert.equal(postsCalls, before + 2)
  view.unmount()
})

test('useApi refetches when a reactive url changes, and skips null', async () => {
  const id = ref(null)
  let api
  const view = mount(() => {
    api = useApi(() => (id.value ? `/api/posts/${id.value}` : null))
    return () => h('p', api.data.value ? api.data.value.title : 'none')
  })
  await settle()
  assert.equal(view.el.textContent, 'none')
  assert.equal(api.loading.value, false)

  id.value = 2
  await settle()
  assert.equal(view.el.textContent, 'Second')
  view.unmount()
})

test('useApi reports HTTP errors', async () => {
  let api
  const view = mount(() => {
    api = useApi('/api/missing')
    return () => h('p', api.error.value ?? '')
  })
  await settle()
  assert.equal(view.el.textContent, 'Not found')
  assert.equal(api.status.value, 404)
  view.unmount()
})

async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
    await nextTick()
  }
}

test('useChannel connects once mounted, delivers messages, sends, and closes on unmount', async () => {
  const { useChannel } = await import('./index.js')
  const fake = installFakeWebSocket()
  const seen = []
  let chat
  try {
    const view = mount(() => {
      chat = useChannel('chat', (message) => seen.push(message))
      return () => h('p', `channel:${chat.status.value}`)
    })
    await new Promise((r) => setTimeout(r, 10))
    await nextTick()
    assert.equal(view.el.textContent, 'channel:open')
    assert.match(fake.sockets[0].url, /\/chat$/)
    chat.send({ text: 'hi' })
    assert.deepEqual(fake.sockets[0].sent, [{ text: 'hi' }])
    fake.sockets[0].receive({ text: 'yo' })
    assert.deepEqual(seen, [{ text: 'yo' }])
    view.unmount()
    assert.equal(fake.sockets[0].readyState, 3)
  } finally {
    fake.restore()
  }
})

test('ErrorBoundary shows the fallback slot for a render error, and recovers on reset or a new resetKey', async () => {
  const broken = ref(true)
  const key = ref('/a')
  let resetFn
  const caught = []
  const Page = { setup: () => () => {
    if (broken.value) throw new Error('page exploded')
    return h('span', '[page]')
  } }
  const view = mount(() => () =>
    h(ErrorBoundary, { resetKey: key.value, onError: (e) => caught.push(e.message) }, {
      default: () => h(Page),
      fallback: ({ error, reset }) => {
        resetFn = reset
        return h('span', `[error:${error.message}]`)
      },
    }),
  )
  await nextTick()
  assert.equal(view.el.textContent, '[error:page exploded]')
  assert.deepEqual(caught, ['page exploded'])

  broken.value = false
  resetFn()
  await nextTick()
  assert.equal(view.el.textContent, '[page]')

  broken.value = true
  await nextTick()
  assert.equal(view.el.textContent, '[error:page exploded]')
  broken.value = false
  key.value = '/b'
  await nextTick()
  await nextTick()
  assert.equal(view.el.textContent, '[page]')
  view.unmount()
})
