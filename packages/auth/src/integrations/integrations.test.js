import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createAuth } from '../session/createAuth.js'
import { applyCookies } from '../http/request.js'
import { createAuthHandler } from './web.js'
import { nextAuthHandlers, nextMiddleware, withNextSession } from './next.js'
import { h3AuthHandler, h3AuthMiddleware, requireH3Session } from './h3.js'
import { sveltekitHandle } from './sveltekit.js'
import { honoAuth, honoAuthRoutes, honoRequireAuth } from './hono.js'
import { expressAuth, requireExpressAuth, koaAuth } from './node.js'
import { createAuthClient } from '../client/client.js'

const SECRET = 'test-secret-that-is-long-enough-0123456789'
const cookiePairs = (cookies) => cookies.map((c) => c.split(';')[0]).join('; ')

async function signedIn() {
  const auth = createAuth({ secret: SECRET })
  const login = await auth.signIn(null, 'u1')
  return { auth, login, cookie: cookiePairs(login.cookies) }
}

test('web handler: session, sessions, refresh, revoke one, logout', async () => {
  const { auth, login, cookie } = await signedIn()
  const handler = createAuthHandler(auth)
  const call = (path, method = 'GET', c = cookie) => handler(new Request(`http://app.test/api/auth${path}`, { method, headers: { cookie: c } }))

  const session = await call('/session')
  assert.equal(session.status, 200)
  assert.equal((await session.json()).userId, 'u1')
  assert.equal(session.headers.get('cache-control'), 'no-store')

  const list = await (await call('/sessions')).json()
  assert.equal(list.sessions[0].current, true)

  const refreshed = await call('/refresh', 'POST')
  assert.equal(refreshed.status, 200)
  assert.equal(refreshed.headers.getSetCookie().length, 2)

  const other = await auth.signIn(null, 'u2')
  assert.equal((await call(`/sessions/${other.session.id}`, 'DELETE', cookiePairs(refreshed.headers.getSetCookie()))).status, 404, "can't end someone else's session")

  const out = await call('/logout', 'POST', cookiePairs(refreshed.headers.getSetCookie()))
  assert.equal(out.status, 204)
  assert.ok(out.headers.getSetCookie().every((c) => c.includes('Max-Age=0')))
  assert.equal(await auth.adapter.get(login.session.id), null)
})

test('next: route handlers, middleware redirect and withNextSession', async () => {
  const { auth, cookie } = await signedIn()
  const { POST } = nextAuthHandlers(auth)
  assert.equal((await POST(new Request('http://app.test/api/auth/refresh', { method: 'POST', headers: { cookie } }))).status, 200)

  const middleware = nextMiddleware(auth, { protect: ['/dashboard'], loginPath: '/login' })
  const guest = await middleware(new Request('http://app.test/dashboard/settings?tab=2'))
  assert.equal(guest.status, 307)
  assert.equal(guest.headers.get('location'), 'http://app.test/login?next=%2Fdashboard%2Fsettings%3Ftab%3D2')
  assert.equal(await middleware(new Request('http://app.test/dashboard', { headers: { cookie } })), undefined)
  assert.equal(await middleware(new Request('http://app.test/about')), undefined)

  const route = withNextSession(auth, (req, { session }) => Response.json({ id: session.userId }))
  assert.equal((await route(new Request('http://app.test/api/me'))).status, 401)
  assert.deepEqual(await (await route(new Request('http://app.test/api/me', { headers: { cookie } }))).json(), { id: 'u1' })
})

function fakeH3Event(url, { method = 'GET', cookie } = {}) {
  const headers = { 'set-cookie': undefined }
  const res = {
    statusCode: 200,
    ended: false,
    getHeader: (n) => headers[n.toLowerCase()],
    setHeader: (n, v) => (headers[n.toLowerCase()] = v),
    end() {
      this.ended = true
    },
  }
  return { event: { path: url, context: {}, node: { req: { method, url, headers: cookie ? { cookie } : {} }, res } }, res, headers }
}

test('h3/nuxt: handler, middleware and requireH3Session', async () => {
  const { auth, cookie } = await signedIn()
  const { event, res, headers } = fakeH3Event('/api/auth/refresh', { method: 'POST', cookie })
  const body = await h3AuthHandler(auth)(event)
  assert.equal(res.statusCode, 200)
  assert.equal(body.ok, true)
  assert.equal(headers['set-cookie'].length, 2)

  const guest = fakeH3Event('/dashboard')
  await h3AuthMiddleware(auth, { protect: ['/dashboard'] })(guest.event)
  assert.equal(guest.res.statusCode, 307)
  assert.equal(guest.headers.location, '/login?next=%2Fdashboard')
  await assert.rejects(() => requireH3Session(auth, guest.event), (e) => e.statusCode === 401)

  const user = fakeH3Event('/dashboard', { cookie })
  await h3AuthMiddleware(auth)(user.event)
  assert.equal((await requireH3Session(auth, user.event)).userId, 'u1')
})

test('sveltekit: handle hook routes, locals.signIn adds cookies, protects paths', async () => {
  const auth = createAuth({ secret: SECRET })
  const handle = sveltekitHandle(auth, { protect: ['/account'] })
  const event = (path, init) => {
    const request = new Request(`http://app.test${path}`, init)
    return { request, url: new URL(request.url), locals: {} }
  }

  const loginEvent = event('/login', { method: 'POST' })
  const response = await handle({
    event: loginEvent,
    resolve: async (e) => {
      await e.locals.signIn('u9')
      return new Response('ok')
    },
  })
  const cookie = cookiePairs(response.headers.getSetCookie())
  assert.ok(cookie.includes('auth.access='))

  const guest = await handle({ event: event('/account'), resolve: async () => new Response('secret') })
  assert.equal(guest.status, 303)

  const routed = await handle({ event: event('/api/auth/session', { headers: { cookie } }), resolve: async () => assert.fail('should not resolve') })
  assert.equal((await routed.json()).userId, 'u9')
})

test('hono: middleware, requireAuth and routes', async () => {
  const { auth, cookie } = await signedIn()
  const context = (request) => {
    const vars = {}
    return { req: { raw: request }, set: (k, v) => (vars[k] = v), get: (k) => vars[k], json: (b, s) => Response.json(b, { status: s }), header() {} }
  }
  const c = context(new Request('http://app.test/api/me', { headers: { cookie } }))
  await honoAuth(auth)(c, async () => {})
  assert.equal(c.get('auth').userId, 'u1')

  const guest = context(new Request('http://app.test/api/me'))
  const denied = await honoRequireAuth(auth)(guest, async () => assert.fail('next called'))
  assert.equal(denied.status, 401)

  const routes = await honoAuthRoutes(auth)(context(new Request('http://app.test/api/auth/session', { headers: { cookie } })))
  assert.equal(routes.status, 200)
})

test('express (real node:http server): middleware, routes, requireAuth, signIn cookies', async () => {
  const auth = createAuth({ secret: SECRET })
  const mw = expressAuth(auth)
  const guard = requireExpressAuth()
  const server = http.createServer((req, res) => {
    mw(req, res, async () => {
      if (req.url === '/login') {
        const { cookies } = await auth.signIn(req, 'u3')
        applyCookies(res, cookies)
        return res.end('ok')
      }
      guard(req, res, () => res.end(JSON.stringify({ id: req.auth.userId })))
    })
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const login = await fetch(`${base}/login`, { method: 'POST' })
    const cookie = cookiePairs(login.headers.getSetCookie())
    assert.equal((await fetch(`${base}/me`)).status, 401)
    assert.deepEqual(await (await fetch(`${base}/me`, { headers: { cookie } })).json(), { id: 'u3' })
    const refresh = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { cookie } })
    assert.equal(refresh.status, 200)
    const crossSite = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie, origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } })
    assert.equal(crossSite.status, 403)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('koa: ctx.state.auth and routes', async () => {
  const { auth, cookie } = await signedIn()
  const set = []
  const ctx = { request: { method: 'GET', url: '/api/me', headers: { cookie } }, res: {}, state: {}, append: (n, v) => set.push([n, v]), set() {} }
  await koaAuth(auth)(ctx, async () => {})
  assert.equal(ctx.state.auth.userId, 'u1')
  const routeCtx = { request: { method: 'POST', url: '/api/auth/refresh', headers: { cookie } }, res: {}, state: {}, append: (n, v) => set.push([n, v]), set() {} }
  await koaAuth(auth)(routeCtx, async () => assert.fail('next called'))
  assert.equal(routeCtx.status, 200)
  assert.equal(set.length, 2)
})

test('browser client: one refresh for concurrent 401s, then replays', async () => {
  let refreshes = 0
  let authed = false
  const fakeFetch = async (url) => {
    const path = new URL(url, 'http://app.test').pathname
    if (path === '/api/auth/refresh') {
      refreshes++
      await new Promise((r) => setTimeout(r, 10))
      authed = true
      return new Response(null, { status: 200 })
    }
    return new Response(null, { status: authed ? 200 : 401 })
  }
  const client = createAuthClient({ fetch: fakeFetch, baseUrl: 'http://app.test' })
  const results = await Promise.all([client.fetch('http://app.test/a'), client.fetch('http://app.test/b'), client.fetch('http://app.test/c')])
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200])
  assert.equal(refreshes, 1)
  client.close()
})
