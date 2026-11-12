import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { Router } from '@tylix/core'
import {
  createInternalFetch,
  createSessionResolver,
  injectServerRender,
  injectSession,
  isProtectedPath,
  loginRedirectLocation,
  serializeForScript,
} from './session.js'

test('protected path patterns', () => {
  const patterns = ['/dashboard/**', '/settings', '/admin/*']
  assert.ok(isProtectedPath(patterns, '/dashboard'))
  assert.ok(isProtectedPath(patterns, '/dashboard/'))
  assert.ok(isProtectedPath(patterns, '/dashboard/mail'))
  assert.ok(isProtectedPath(patterns, '/dashboard/a/b'))
  assert.ok(!isProtectedPath(patterns, '/dashboards'))
  assert.ok(isProtectedPath(patterns, '/settings'))
  assert.ok(!isProtectedPath(patterns, '/settings/x'))
  assert.ok(isProtectedPath(patterns, '/admin/users'))
  assert.ok(!isProtectedPath(patterns, '/admin'))
  assert.ok(!isProtectedPath(patterns, '/admin/users/1'))
  assert.ok(!isProtectedPath(patterns, '/'))
  assert.ok(!isProtectedPath(undefined, '/dashboard'))
  assert.ok(!isProtectedPath(['dashboard'], '/dashboard'), 'patterns must start with /')
})

test('the login redirect keeps the requested URL in ?next=', () => {
  assert.equal(loginRedirectLocation('/login', '/dashboard/mail?tab=2'), '/login?next=%2Fdashboard%2Fmail%3Ftab%3D2')
})

test('the injected session cannot break out of its <script> tag', () => {
  const user = { name: '</script><script>alert(1)</script>', bio: 'a & b > c', sep: '  ' }
  const html = injectSession('<html><head><title>x</title></head><body></body></html>', { user })

  // Exactly one script tag opens and closes: the injected one.
  assert.equal(html.match(/<script/g).length, 1)
  assert.equal(html.match(/<\/script>/g).length, 1)

  // And it evaluates back to the original data.
  const code = html.match(/<script>(.*?)<\/script>/)[1]
  const sandbox = { window: {} }
  vm.runInNewContext(code, sandbox)
  // Re-serialised because objects from the sandbox have its own prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.__TYLIX_SESSION__)), { user })
})

test('the session goes first in <head>, before any module script', () => {
  const html = injectSession('<head lang="x"><script type="module" src="/main.jsx"></script></head>', { user: { id: 1 } })
  assert.match(html, /^<head lang="x"><script>window\.__TYLIX_SESSION__=/)
  assert.equal(injectSession('<head></head>', null), '<head></head>')
})

test('serializeForScript escapes only what is needed', () => {
  assert.equal(serializeForScript({ a: 1 }), '{"a":1}')
  assert.equal(serializeForScript('<>&'), '"\\u003c\\u003e\\u0026"')
})

function routerWithMe(handler) {
  const router = new Router()
  router.get('/api/me', handler)
  return router
}

const pageRequest = (cookie) => ({ method: 'GET', url: '/dashboard', headers: cookie ? { cookie } : {} })

test('resolves the user through the real /api/me route', async () => {
  const resolve = createSessionResolver(
    routerWithMe((req, res) => {
      assert.equal(req.cookies.tylix_access_token, 'abc')
      res.json({ id: 1, name: 'Ada' })
    }),
  )
  assert.deepEqual(await resolve(pageRequest('tylix_access_token=abc')), { user: { id: 1, name: 'Ada' } })
})

test('no cookie means no lookup at all', async () => {
  let called = false
  const resolve = createSessionResolver(routerWithMe(() => (called = true)))
  assert.equal(await resolve(pageRequest()), null)
  assert.equal(called, false)
})

test('a rejected or failing /api/me resolves to no session', async () => {
  const rejected = createSessionResolver(routerWithMe((req, res) => res.status(401).json({ error: 'Not authenticated.' })))
  assert.equal(await rejected(pageRequest('tylix_access_token=old')), null)

  const error = console.error
  console.error = () => {}
  try {
    const failing = createSessionResolver(routerWithMe(() => {
      throw new Error('db down')
    }))
    assert.equal(await failing(pageRequest('tylix_access_token=abc')), null)
  } finally {
    console.error = error
  }
})

test('internal fetch runs the real route chain as the visitor', async () => {
  const router = new Router()
  const seen = []
  router.use(async (req, res, next) => {
    seen.push(`middleware ${req.url}`)
    await next()
  })
  router.get('/api/posts/:id', (req, res) => {
    res.json({ id: req.params.id, page: req.query.page, token: req.cookies.tylix_access_token })
  })
  router.get('/api/secret', (req, res) => res.status(401).json({ error: 'Not authenticated.' }))
  router.get('/api/boom', () => {
    throw new Error('db down')
  })
  const internalFetch = createInternalFetch(router)
  const visitor = pageRequest('tylix_access_token=abc')

  assert.deepEqual(await internalFetch(visitor, '/api/posts/7?page=2'), {
    status: 200,
    data: { id: '7', page: '2', token: 'abc' },
  })
  assert.deepEqual(seen, ['middleware /api/posts/7?page=2'], 'global middleware ran')
  assert.deepEqual(await internalFetch(visitor, '/api/secret'), { status: 401, data: { error: 'Not authenticated.' } })
  assert.equal((await internalFetch(visitor, '/api/missing')).status, 404)

  // Only the app's own API: SSR must not become a way to reach other URLs.
  for (const url of ['/dashboard', 'http://evil.example/api/x', '//evil.example/api/x']) {
    assert.equal((await internalFetch(visitor, url)).status, 400, url)
  }

  const error = console.error
  console.error = () => {}
  try {
    assert.equal((await internalFetch(visitor, '/api/boom')).status, 500, 'a throwing route never throws here')
  } finally {
    console.error = error
  }
})

test('the server-render marker carries data safely', () => {
  const html = injectServerRender('<head></head>', { '/api/x': { data: '</script><script>alert(1)' } })
  assert.equal(html.match(/<script/g).length, 1)
  assert.match(html, /window\.__TYLIX_SSR__=true;window\.__TYLIX_DATA__=/)
})

test('an app without auth has no session', async () => {
  const resolve = createSessionResolver(new Router())
  assert.equal(await resolve(pageRequest('tylix_access_token=abc')), null)
})
