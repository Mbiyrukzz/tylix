import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/start' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
window.scrollTo = () => {}
after(() => dom.window.close())

// Fake backend on globalThis.fetch, used by the shared client instance.
const session = { access: false }
const user = { id: 3, name: 'Linus', email: 'linus@example.com' }
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
      return json(200, [{ id: 1 }])
    default:
      return json(404, { error: 'Not found' })
  }
}

const { session: sessionStore, useApi, auth, route, navigate, matchPath } = await import('./index.js')
const { readable } = await import('./store.js')
const { shouldHandleClick } = await import('./router.js')

const settle = () => new Promise((r) => setTimeout(r, 20))
function collect(store) {
  const values = []
  const unsubscribe = store.subscribe((v) => values.push(v))
  return { values, unsubscribe, last: () => values[values.length - 1] }
}

test('readable follows the Svelte store contract', () => {
  let started = 0
  let stopped = 0
  const store = readable(1, (set) => {
    started++
    set(2)
    return () => stopped++
  })
  const a = collect(store)
  const b = collect(store)
  assert.deepEqual(a.values, [2], 'called right away with the current value')
  assert.deepEqual(b.values, [2])
  assert.equal(started, 1, 'start runs once for many subscribers')
  a.unsubscribe()
  assert.equal(stopped, 0)
  b.unsubscribe()
  assert.equal(stopped, 1, 'stop runs when the last subscriber leaves')
})

test('session: loading, then guest, then authenticated after login, then guest', async () => {
  const s = collect(sessionStore)
  assert.equal(s.values[0].status, 'loading')
  // Wait for the condition, not a fixed time: the check is two requests.
  await waitFor(() => s.last().status === 'guest')
  assert.equal(s.last().expired, false)

  await auth.login('linus@example.com', 'x')
  assert.equal(s.last().isAuthenticated, true)
  assert.equal(s.last().user.name, 'Linus')

  await auth.logout()
  assert.equal(s.last().status, 'guest')
  s.unsubscribe()
})

test('useApi fetches on subscribe and exposes data', async () => {
  const before = postsCalls
  const posts = useApi('/api/posts')
  const s = collect(posts)
  assert.equal(s.values[0].loading, true)
  await settle()
  assert.deepEqual(s.last().data, [{ id: 1 }])
  assert.equal(s.last().loading, false)
  assert.equal(postsCalls, before + 1)

  await posts.reload()
  assert.equal(postsCalls, before + 2)
  s.unsubscribe()
})

test('useApi(null) does not fetch; errors are reported', async () => {
  const before = postsCalls
  const idle = collect(useApi(null))
  await settle()
  assert.equal(idle.last().loading, false)
  assert.equal(postsCalls, before)
  idle.unsubscribe()

  const missing = collect(useApi('/api/missing'))
  await settle()
  assert.equal(missing.last().error, 'Not found')
  assert.equal(missing.last().status, 404)
  missing.unsubscribe()
})

test('matchPath', () => {
  assert.deepEqual(matchPath('/', '/'), {})
  assert.deepEqual(matchPath('/posts/:id', '/posts/42'), { id: '42' })
  assert.deepEqual(matchPath('/posts/:id', '/posts/42/'), { id: '42' })
  assert.equal(matchPath('/posts/:id', '/posts'), null)
  assert.equal(matchPath('/posts/:id', '/posts/42/edit'), null)
  assert.equal(matchPath('/login', '/login-x'), null)
  assert.deepEqual(matchPath('/files/*', '/files/a/b%20c'), { '*': 'a/b c' })
  assert.deepEqual(matchPath('/a/:x', '/a/hello%2Fworld'), { x: 'hello/world' })
})

test('navigate updates the route store and history', () => {
  const r = collect(route)
  assert.equal(r.last().path, '/start')
  navigate('/posts?page=2')
  assert.equal(window.location.pathname, '/posts')
  assert.equal(r.last().path, '/posts')
  assert.equal(r.last().query.get('page'), '2')

  const length = window.history.length
  navigate('/login', { replace: true })
  assert.equal(window.history.length, length, 'replace adds no history entry')
  assert.equal(r.last().path, '/login')
  r.unsubscribe()
})

test('internal link clicks are routed without a page load', () => {
  const r = collect(route)
  document.body.innerHTML = '<a id="in" href="/dashboard"><span id="inner">Go</span></a>'
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  document.getElementById('inner').dispatchEvent(event)
  assert.equal(event.defaultPrevented, true)
  assert.equal(r.last().path, '/dashboard')
  r.unsubscribe()

  // After the last unsubscribe the click handler is gone.
  document.body.innerHTML = '<a id="later" href="/elsewhere">x</a>'
  const later = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  document.getElementById('later').dispatchEvent(later)
  assert.equal(later.defaultPrevented, false)
})

test('links the router must leave alone', () => {
  const origin = 'http://localhost'
  const anchor = (attrs) => {
    const a = document.createElement('a')
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
    return a
  }
  const click = (extra = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra })

  assert.equal(shouldHandleClick(click(), anchor({ href: '/posts' }), origin), true)
  assert.equal(shouldHandleClick(click(), anchor({ href: 'https://example.com/' }), origin), false, 'other site')
  assert.equal(shouldHandleClick(click(), anchor({ href: '/api/auth/verify-email?token=x' }), origin), false, 'server URL')
  assert.equal(shouldHandleClick(click(), anchor({ href: '/a', target: '_blank' }), origin), false)
  assert.equal(shouldHandleClick(click(), anchor({ href: '/a', download: '' }), origin), false)
  assert.equal(shouldHandleClick(click(), anchor({ href: '/a', 'data-native': '' }), origin), false)
  assert.equal(shouldHandleClick(click(), anchor({ href: '/a', rel: 'noopener external' }), origin), false)
  assert.equal(shouldHandleClick(click({ metaKey: true }), anchor({ href: '/a' }), origin), false, 'cmd-click opens a tab')
  assert.equal(shouldHandleClick(click({ button: 1 }), anchor({ href: '/a' }), origin), false)
  assert.equal(shouldHandleClick(click(), anchor({}), origin), false, 'no href')
})

async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}
