import { handleAuthRoute, toResponse } from './routes.js'

// Hono (Node, Bun, Deno, Workers).
//
//   app.use('*', honoAuth(auth))                 // c.get('auth'): session or null
//   app.all('/api/auth/*', honoAuthRoutes(auth))
//   app.get('/api/me', honoRequireAuth(auth), (c) => c.json({ id: c.get('auth').userId }))
//
//   // in your login route, after checking the password
//   const { cookies } = await auth.signIn(c, user.id)
//   applyCookies(c, cookies)

export function honoAuth(auth, options) {
  return async (c, next) => {
    c.set('auth', await auth.getSession(c.req.raw, options))
    await next()
  }
}

export function honoRequireAuth(auth, options) {
  return async (c, next) => {
    const session = c.get?.('auth') ?? (await auth.getSession(c.req.raw, options))
    if (!session) return c.json({ error: 'Not authenticated.' }, 401)
    c.set('auth', session)
    await next()
  }
}

export function honoAuthRoutes(auth, options) {
  return async (c) => {
    const result = await handleAuthRoute(auth, c.req.raw, options)
    return toResponse(result ?? { status: 404, body: { error: 'Not found.' } })
  }
}

export { applyCookies } from '../http/request.js'
