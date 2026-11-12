import { parseCookies, parseQuery } from '@tylix/core'

// Server-side session helpers for hosted frontends (React, ...).
//
// When the browser loads a page, the server already has the auth cookie,
// so it can tell the app who is logged in right away. That saves the
// /api/me round trip and the loading spinner on first paint, and lets the
// server send guests away from protected pages before any HTML is sent.
//
// Only the access-token cookie reaches page requests: the refresh-token
// cookie is scoped to /api/auth/refresh. So "no valid access token" means
// "maybe logged out", never "certainly logged out", and both features are
// written with that in mind:
//   - a user is injected only when the access token is valid; otherwise
//     nothing is injected and the client checks (and refreshes) itself
//   - a protected-page redirect goes to the login page with ?next=, and
//     the login page sends a user whose refresh still works straight back

// Answers a GET for one of the app's own API routes in-process, as the
// visitor of `req` (same cookies, so the same session). Used by
// server-side rendering, which needs the data a page asks for before it can
// render it, and by the session lookup below. It runs the full middleware
// chain plus requireAuth, exactly like a real request.
//
// Resolves { status, data } and never throws. Only /api/ paths are
// allowed: SSR must not be turned into a way to reach other URLs.
export function createInternalFetch(router) {
  return async function internalFetch(req, url) {
    if (typeof url !== 'string' || !url.startsWith('/api/')) {
      return { status: 400, data: { error: 'Server rendering can only load /api/ URLs.' } }
    }
    const match = router.match('GET', url)
    if (!match) return { status: 404, data: { error: 'Not found' } }

    const fakeReq = {
      method: 'GET',
      url,
      headers: req.headers,
      cookies: parseCookies(req),
      params: match.params,
      query: parseQuery(url),
      body: null,
      rawBody: '',
      ip: req.ip,
      secure: req.secure,
    }
    let status = 200
    let data = null
    const fakeRes = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader() {},
      getHeader() {},
      status(code) {
        status = code
        this.statusCode = code
        return this
      },
      json(body) {
        data = body
        return this
      },
      send(body) {
        data = body ?? null
        return this
      },
      end() {},
      cookie() {},
      clearCookie() {},
    }

    try {
      await match.handler(fakeReq, fakeRes)
    } catch (err) {
      console.error(`[tylix] Server rendering could not load ${url}:`, err)
      return { status: 500, data: { error: 'Server error' } }
    }
    return { status, data }
  }
}

// Runs the app's own GET /api/me route in-process, so the injected user is
// exactly what the client would have fetched (same controller, same
// toSafeObject filtering). Resolves null for anything but a 200.
export function createSessionResolver(router) {
  const internalFetch = createInternalFetch(router)
  return async function resolveSession(req) {
    if (!router.match('GET', '/api/me')) return null // auth is not enabled

    const cookies = parseCookies(req)
    if (!cookies.tylix_access_token && !req.headers?.authorization) return null

    const { status, data } = await internalFetch(req, '/api/me')
    return status === 200 && data && typeof data === 'object' ? { user: data } : null
  }
}

// Patterns from frontend.protected in tylix.config:
//   "/dashboard"     exactly that path
//   "/dashboard/*"   one segment below it (not /dashboard itself)
//   "/dashboard/**"  /dashboard and everything below it
export function isProtectedPath(patterns, pathname) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return patterns.some((pattern) => {
    if (typeof pattern !== 'string' || !pattern.startsWith('/')) return false
    if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3) || '/'
      return base === '/' || path === base || path.startsWith(base + '/')
    }
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2)
      const rest = path.startsWith(base + '/') ? path.slice(base.length + 1) : null
      return Boolean(rest) && !rest.includes('/')
    }
    return path === pattern.replace(/\/+$/, '')
  })
}

// Where a guest asking for `url` is sent. `next` brings them back after
// logging in; the login page only accepts same-site paths from it.
export function loginRedirectLocation(loginPath, url) {
  return `${loginPath}?next=${encodeURIComponent(url)}`
}

// JSON is not safe inside <script> as-is: a user named "</script><script>…"
// would end the tag. Escaping <, > and & (plus the JS line separators)
// keeps the value inert.
export function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// Marks the page as server-rendered (so the client hydrates instead of
// rendering from scratch) and puts the data the render loaded in it, for
// useApi to pick up during hydration instead of fetching it again.
export function injectServerRender(html, data) {
  return insertHeadScript(
    html,
    `window.__TYLIX_SSR__=true;window.__TYLIX_DATA__=${serializeForScript(data ?? {})}`,
  )
}

function insertHeadScript(html, code) {
  const tag = `<script>${code}</script>`
  const headOpen = html.match(/<head[^>]*>/i)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return html.slice(0, at) + tag + html.slice(at)
  }
  return tag + html
}

// Puts the session in the page before any module script runs. Classic
// inline scripts in <head> always execute before type="module" scripts.
export function injectSession(html, session) {
  if (!session) return html
  return insertHeadScript(html, `window.__TYLIX_SESSION__=${serializeForScript(session)}`)
}
