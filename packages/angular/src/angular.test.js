import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  globalThis[key] = dom.window[key] ?? dom.window
}
globalThis.window = dom.window
globalThis.document = dom.window.document

// Fake backend on globalThis.fetch, used by the shared client instance.
const session = { access: false, refresh: false }
const user = { id: 4, name: 'Misko', email: 'misko@example.com' }
const calls = []
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url, 'http://x').pathname
  calls.push(`${init.method} ${path}`)
  await new Promise((r) => setTimeout(r, 1))
  switch (`${init.method} ${path}`) {
    case 'GET /api/me':
      return session.access ? json(200, user) : json(401, { error: 'Not authenticated.' })
    case 'POST /api/login':
      session.access = true
      session.refresh = true
      return json(200, { user })
    case 'POST /api/auth/refresh':
      if (!session.refresh) return json(401, {})
      session.access = true
      return json(200, { ok: true })
    case 'POST /api/auth/logout':
      session.access = false
      session.refresh = false
      return new Response(null, { status: 204 })
    case 'GET /api/posts/1':
      return json(200, { id: 1, title: 'One' })
    case 'GET /api/posts/2':
      return json(200, { id: 2, title: 'Two' })
    default:
      return json(404, { error: 'Not found' })
  }
}

// Angular's packages ship partially compiled; outside a build (where the
// Vite plugin links them) they need the JIT compiler loaded first.
await import('@angular/compiler')
const { ApplicationRef, provideZonelessChangeDetection, runInInjectionContext, signal, createEnvironmentInjector, EnvironmentInjector } = await import('@angular/core')
const { createApplication } = await import('@angular/platform-browser')
const { HttpClient, provideHttpClient, withFetch, withInterceptors } = await import('@angular/common/http')
const { firstValueFrom } = await import('rxjs')
const { injectAuth, injectApi, sessionReady, auth, tylixInterceptor, provideAppErrorHandler, injectAppError } = await import('./index.js')
const { decideAccess, nextPath, canRefreshAfter401 } = await import('./access.js')

const appRef = await createApplication({
  providers: [provideZonelessChangeDetection(), provideHttpClient(withFetch(), withInterceptors([tylixInterceptor]))],
})
after(() => {
  appRef.destroy()
  dom.window.close()
})

const settle = async () => {
  await new Promise((r) => setTimeout(r, 20))
  await appRef.whenStable()
}

test('access rules', () => {
  assert.deepEqual(decideAccess('auth', 'guest', '/dashboard'), { login: '/dashboard' })
  assert.equal(decideAccess('auth', 'authenticated', '/dashboard'), null)
  assert.deepEqual(decideAccess('guest', 'authenticated', '/login', '/posts'), { to: '/posts' })
  assert.deepEqual(decideAccess('guest', 'authenticated', '/login', '//evil.com'), { to: '/dashboard' })
  assert.equal(decideAccess('guest', 'guest', '/login'), null)
  assert.equal(decideAccess(undefined, 'guest', '/'), null)
  assert.equal(nextPath('https://evil.com'), '/dashboard')
  assert.equal(nextPath('/\\evil.com'), '/dashboard')
  assert.equal(canRefreshAfter401('/api/posts?x=1'), true)
  assert.equal(canRefreshAfter401('/api/login'), false)
  assert.equal(canRefreshAfter401('http://localhost/api/auth/refresh'), false)
})

test('injectAuth signals follow the session', async () => {
  const { status, user: current, isAuthenticated } = injectAuth()
  await sessionReady()
  assert.equal(status(), 'guest')

  await auth.login('misko@example.com', 'x')
  assert.equal(isAuthenticated(), true)
  assert.equal(current().name, 'Misko')

  await auth.logout()
  assert.equal(status(), 'guest')
  assert.equal(current(), null)
})

test('injectApi fetches, refetches when its signals change, and stops on destroy', async () => {
  const child = createEnvironmentInjector([], appRef.injector.get(EnvironmentInjector))
  const id = signal(1)
  const post = runInInjectionContext(child, () => injectApi(() => `/api/posts/${id()}`))

  // Wait for conditions, not fixed times: test files run in parallel.
  await waitFor(() => post.data()?.id === 1)
  assert.deepEqual(post.data(), { id: 1, title: 'One' })
  assert.equal(post.status(), 200)
  assert.equal(post.loading(), false)

  id.set(2)
  await waitFor(() => post.data()?.id === 2)
  assert.deepEqual(post.data(), { id: 2, title: 'Two' })

  const before = calls.length
  child.destroy()
  id.set(1)
  await settle()
  assert.equal(calls.length, before, 'no fetch after the injector is destroyed')
})

test('injectApi skips null and reports errors', async () => {
  const child = createEnvironmentInjector([], appRef.injector.get(EnvironmentInjector))
  const skipped = runInInjectionContext(child, () => injectApi(null))
  const missing = runInInjectionContext(child, () => injectApi('/api/missing'))
  await waitFor(() => missing.status() === 404)
  assert.equal(skipped.data(), null)
  assert.equal(skipped.loading(), false)
  assert.equal(missing.error(), 'Not found')
  assert.equal(missing.status(), 404)
  child.destroy()
})

test('the HttpClient interceptor renews an expired session once and retries', async () => {
  const http = appRef.injector.get(HttpClient)
  await auth.login('misko@example.com', 'x')
  session.access = false // access cookie expired, refresh still valid

  const refreshesBefore = calls.filter((c) => c === 'POST /api/auth/refresh').length
  const results = await Promise.all([
    firstValueFrom(http.get('/api/me')),
    firstValueFrom(http.get('/api/me')),
  ])
  assert.deepEqual(results, [user, user])
  const refreshes = calls.filter((c) => c === 'POST /api/auth/refresh').length - refreshesBefore
  assert.equal(refreshes, 1, 'concurrent 401s share one refresh')
})

test('the interceptor gives up when the refresh fails, ending the session', async () => {
  const http = appRef.injector.get(HttpClient)
  session.access = false
  session.refresh = false
  await assert.rejects(firstValueFrom(http.get('/api/me')), (err) => err.status === 401)
  assert.deepEqual(auth.getState(), { status: 'guest', user: null, expired: true })
})

test('the interceptor never refreshes after a failed login', async () => {
  const http = appRef.injector.get(HttpClient)
  const before = calls.filter((c) => c === 'POST /api/auth/refresh').length
  globalThis.fetch = (orig => async (url, init) => {
    if (new URL(url, 'http://x').pathname === '/api/login') return json(401, { error: 'Invalid email or password.' })
    return orig(url, init)
  })(globalThis.fetch)
  await assert.rejects(firstValueFrom(http.post('/api/login', { email: 'a', password: 'b' })), (err) => err.status === 401)
  assert.equal(calls.filter((c) => c === 'POST /api/auth/refresh').length, before)
})

async function waitFor(check, timeoutMs = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
    await appRef.whenStable()
  }
}

test('provideAppErrorHandler keeps unhandled errors in a signal until cleared', async () => {
  const { ErrorHandler } = await import('@angular/core')
  const errorApp = await createApplication({
    providers: [provideZonelessChangeDetection(), provideAppErrorHandler({ onError: (e) => reported.push(e.message) })],
  })
  const reported = []
  const originalError = console.error
  console.error = () => {}
  try {
    const appError = runInInjectionContext(errorApp.injector, () => injectAppError())
    assert.equal(appError.error(), null)
    errorApp.injector.get(ErrorHandler).handleError(new Error('template exploded'))
    assert.equal(appError.error().message, 'template exploded')
    assert.deepEqual(reported, ['template exploded'])
    appError.clear()
    assert.equal(appError.error(), null)
  } finally {
    console.error = originalError
    errorApp.destroy()
  }
})
