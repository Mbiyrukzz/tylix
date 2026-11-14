import { handleAuthRoute, matchesProtected, toResponse } from './routes.js'
import { safeRedirectPath } from '../http/origin.js'

// SvelteKit.
//
//   // src/hooks.server.js
//   export const handle = sveltekitHandle(auth, { protect: ['/dashboard'] })
//
// Then, in load functions and actions:
//   event.locals.auth                  the session, or null
//   await event.locals.signIn(userId)  after checking the password
//   await event.locals.signOut()
// The cookies these set are added to the response automatically.

export function sveltekitHandle(auth, { basePath = '/api/auth', protect, loginPath = '/login', user } = {}) {
  return async function handle({ event, resolve }) {
    const routed = await handleAuthRoute(auth, event.request, { basePath, user })
    if (routed) return toResponse(routed)

    const pending = []
    event.locals.auth = await auth.getSession(event.request)
    event.locals.signIn = async (userId, options) => {
      const result = await auth.signIn(event.request, userId, options)
      pending.push(...result.cookies)
      event.locals.auth = { userId: result.session.userId, sessionId: result.session.id, session: result.session }
      return result
    }
    event.locals.signOut = async () => {
      const result = await auth.signOut(event.request)
      pending.push(...result.cookies)
      event.locals.auth = null
      return result
    }

    if (!event.locals.auth && matchesProtected(protect, event.url.pathname)) {
      const next = safeRedirectPath(event.url.pathname + event.url.search)
      return new Response(null, { status: 303, headers: { Location: `${loginPath}?next=${encodeURIComponent(next)}` } })
    }

    const response = await resolve(event)
    if (pending.length === 0) return response
    try {
      for (const c of pending) response.headers.append('Set-Cookie', c)
      return response
    } catch {
      // Immutable headers (a fetched Response passed through): copy it.
      const copy = new Response(response.body, response)
      for (const c of pending) copy.headers.append('Set-Cookie', c)
      return copy
    }
  }
}
