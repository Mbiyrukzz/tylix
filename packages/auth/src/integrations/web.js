import { safeRedirectPath } from '../http/origin.js'
import { getPathname, unwrapRequest } from '../http/request.js'
import { handleAuthRoute, matchesProtected, toResponse } from './routes.js'

// Web-standard (Request -> Response) integration. Works as-is with Remix,
// React Router, Astro, SolidStart, Bun.serve, Deno.serve, Cloudflare
// Workers and Next.js route handlers.

/** A fetch-style handler for the session endpoints under basePath. */
export function createAuthHandler(auth, options = {}) {
  return async function handler(request) {
    const result = await handleAuthRoute(auth, request, options)
    return toResponse(result ?? { status: 404, body: { error: 'Not found.' } })
  }
}

/** JSON Response carrying the Set-Cookie headers from signIn/signOut/refresh. */
export function jsonWithCookies(body, { status = 200, cookies = [], headers } = {}) {
  const out = new Headers(headers)
  out.set('Content-Type', 'application/json; charset=utf-8')
  out.set('Cache-Control', 'no-store')
  for (const c of cookies) out.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers: out })
}

/** A redirect Response carrying Set-Cookie headers. */
export function redirectWithCookies(location, { status = 303, cookies = [] } = {}) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status, headers })
}

/**
 * Wraps a Request -> Response handler so it only runs for a signed-in
 * user; the session is passed as the second argument's `session`.
 */
export function withSession(auth, handler, { optional = false, checkRevocation } = {}) {
  return async (request, context = {}) => {
    const session = await auth.getSession(request, { checkRevocation })
    if (!session && !optional) return jsonWithCookies({ error: 'Not authenticated.' }, { status: 401 })
    return handler(request, { ...context, session })
  }
}

/**
 * For middleware that runs before pages: sends guests on protected paths
 * to the login page (with ?next=). Stateless (no session store lookup),
 * so it runs on the edge. Resolves a redirect Response, or null to let
 * the request continue.
 */
export async function guardRequest(auth, request, { protect, loginPath = '/login', guestOnly, homePath = '/' } = {}) {
  const pathname = getPathname(request)
  const needsUser = matchesProtected(protect, pathname)
  const needsGuest = matchesProtected(guestOnly, pathname)
  if (!needsUser && !needsGuest) return null

  const session = await auth.getSession(request, { checkRevocation: false })
  const raw = unwrapRequest(request)
  const base = typeof raw.url === 'string' && /^https?:/.test(raw.url) ? raw.url : 'http://localhost'

  if (needsUser && !session) {
    const url = new URL(raw.url ?? '/', 'http://localhost')
    const target = new URL(loginPath, base)
    target.searchParams.set('next', safeRedirectPath(url.pathname + url.search))
    return Response.redirect(target.toString(), 307)
  }
  if (needsGuest && session) return Response.redirect(new URL(homePath, base).toString(), 307)
  return null
}
