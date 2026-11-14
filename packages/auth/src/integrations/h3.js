import { applyCookies } from '../http/request.js'
import { handleAuthRoute, matchesProtected } from './routes.js'
import { safeRedirectPath } from '../http/origin.js'

// Nuxt / Nitro / h3. No import of h3 itself, so any h3 version works.
//
//   // server/api/auth/[...].ts
//   export default defineEventHandler(h3AuthHandler(auth))
//
//   // server/middleware/auth.ts
//   export default defineEventHandler(h3AuthMiddleware(auth))
//   // then in any handler: event.context.auth (null for guests)
//
//   // a protected handler
//   const session = await requireH3Session(auth, event)
//
//   // after checking a password in your login handler
//   const { cookies } = await auth.signIn(event, user.id)
//   applyCookies(event, cookies)

function httpError(statusCode, message) {
  // h3's error handler reads statusCode/statusMessage from thrown errors.
  return Object.assign(new Error(message), { statusCode, status: statusCode, statusMessage: message, data: { error: message } })
}

function nodeRes(event) {
  return event.node?.res ?? event.res
}

export function h3AuthHandler(auth, options = {}) {
  return async function handler(event) {
    const result = await handleAuthRoute(auth, event, options)
    const res = nodeRes(event)
    if (!result) throw httpError(404, 'Not found.')
    applyCookies(event, result.cookies)
    if (res?.setHeader) {
      res.statusCode = result.status
      res.setHeader('Cache-Control', 'no-store')
    } else if (res) {
      res.status = result.status // h3 v2
      res.headers?.set?.('Cache-Control', 'no-store')
    }
    return result.body ?? null
  }
}

/** Sets event.context.auth to the session (or null) for every request. */
export function h3AuthMiddleware(auth, { protect, loginPath = '/login' } = {}) {
  return async function middleware(event) {
    event.context ??= {}
    event.context.auth = await auth.getSession(event)
    const path = (event.path ?? event.node?.req?.url ?? '/').split('?')[0]
    if (protect && !event.context.auth && matchesProtected(protect, path)) {
      const res = nodeRes(event)
      const location = `${loginPath}?next=${encodeURIComponent(safeRedirectPath(event.path ?? event.node?.req?.url ?? '/'))}`
      res.statusCode = 307
      res.setHeader('Location', location)
      res.end()
    }
  }
}

/** The session, or throws a 401 that h3 turns into a JSON error. */
export async function requireH3Session(auth, event, options) {
  const session = event.context?.auth ?? (await auth.getSession(event, options))
  if (!session) throw httpError(401, 'Not authenticated.')
  return session
}

export { applyCookies } from '../http/request.js'
