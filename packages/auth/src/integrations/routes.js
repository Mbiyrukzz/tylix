import { getMethod, getPathname } from '../http/request.js'

// The session endpoints every app needs, independent of any framework.
// Mounted under basePath (default /api/auth):
//
//   POST   /refresh               rotate the refresh token, new access token
//   POST   /logout                end this session
//   POST   /logout-all            end every session of this user
//   GET    /session               who is signed in (401 if nobody)
//   GET    /sessions              this user's active sessions ("devices")
//   DELETE /sessions/:id          end one of them
//
// Each adapter turns the { status, body, cookies } result into its own
// response type. Login and registration stay in your code: verify the
// password your way, then call auth.signIn(request, userId).

const NO_SESSION = { status: 401, body: { error: 'Not authenticated.' }, cookies: [] }

export async function handleAuthRoute(auth, request, { basePath = '/api/auth', user } = {}) {
  const pathname = getPathname(request)
  const base = basePath.replace(/\/+$/, '')
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null
  const route = pathname.slice(base.length) || '/'
  const method = getMethod(request)

  if (route === '/refresh' && method === 'POST') {
    const result = await auth.refresh(request)
    if (!result.ok) {
      const status = result.reason === 'cross-site' ? 403 : 401
      return { status, body: { error: status === 403 ? 'Cross-site request blocked.' : 'Session expired. Please sign in again.', reason: result.reason }, cookies: result.cookies }
    }
    return { status: 200, body: { ok: true, session: result.session }, cookies: result.cookies }
  }

  if (route === '/logout' && method === 'POST') {
    if (auth.isCrossSite(request)) return { status: 403, body: { error: 'Cross-site request blocked.' }, cookies: [] }
    const result = await auth.signOut(request)
    return { status: 204, body: null, cookies: result.cookies }
  }

  if (route === '/session' && method === 'GET') {
    const session = await auth.getSession(request)
    if (!session) return NO_SESSION
    const body = { userId: session.userId, session: session.session }
    if (typeof user === 'function') body.user = await user(session.userId, session)
    return { status: 200, body, cookies: [] }
  }

  if (route === '/sessions' && method === 'GET') {
    const session = await auth.getSession(request)
    if (!session) return NO_SESSION
    return { status: 200, body: { sessions: await auth.listSessions(session.userId, { currentSessionId: session.sessionId }) }, cookies: [] }
  }

  const one = /^\/sessions\/([A-Za-z0-9_-]{22})$/.exec(route)
  if (one && method === 'DELETE') {
    const session = await auth.getSession(request)
    if (!session) return NO_SESSION
    // Only the user's own sessions: an unknown id and someone else's id
    // get the same answer.
    const owned = (await auth.listSessions(session.userId)).some((s) => s.id === one[1])
    if (!owned) return { status: 404, body: { error: 'Session not found.' }, cookies: [] }
    await auth.revokeSession(one[1])
    return { status: 204, body: null, cookies: one[1] === session.sessionId ? auth.clearCookies(request) : [] }
  }

  if (route === '/logout-all' && method === 'POST') {
    const session = await auth.getSession(request)
    if (!session) return NO_SESSION
    await auth.revokeAllSessions(session.userId)
    return { status: 204, body: null, cookies: auth.clearCookies(request) }
  }

  return { status: 404, body: { error: 'Not found.' }, cookies: [] }
}

/** Turns a route result into a Web Response. */
export function toResponse({ status, body, cookies }) {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  for (const c of cookies ?? []) headers.append('Set-Cookie', c)
  if (body == null) return new Response(null, { status, headers })
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

/** Is this path protected? `protect` is a list of prefixes, a RegExp or a function. */
export function matchesProtected(protect, pathname) {
  if (!protect) return false
  if (typeof protect === 'function') return Boolean(protect(pathname))
  if (protect instanceof RegExp) return protect.test(pathname)
  return protect.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
}
