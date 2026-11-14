import { createAuthHandler, guardRequest, withSession } from './web.js'

// Next.js (App Router, Node or Edge runtime).
//
//   // app/api/auth/[...auth]/route.js
//   export const { GET, POST, DELETE } = nextAuthHandlers(auth)
//
//   // middleware.js
//   export default nextMiddleware(auth, { protect: ['/dashboard'], loginPath: '/login' })
//
//   // a Server Component / Server Action / route handler
//   const session = await auth.getSession(await headers())

export function nextAuthHandlers(auth, options) {
  const handler = createAuthHandler(auth, options)
  return { GET: handler, POST: handler, DELETE: handler }
}

/**
 * Edge middleware: redirects guests away from protected paths. Returns
 * undefined to let everything else through (Next's NextResponse.next()).
 * Token checks are stateless here; route handlers and server components
 * still call auth.getSession(), which checks revocation.
 */
export function nextMiddleware(auth, options = {}) {
  return async function middleware(request) {
    return (await guardRequest(auth, request, options)) ?? undefined
  }
}

/** Route handler that requires a signed-in user: (request, { params, session }) => Response. */
export function withNextSession(auth, handler, options) {
  return withSession(auth, handler, options)
}

export { jsonWithCookies, redirectWithCookies } from './web.js'
