import { parseCookieHeaderAll } from './cookies.js'

// Reads what auth needs from whatever a framework calls a request:
//
//   Web Request             Next.js App Router, Remix, Astro, Bun, Deno, Workers
//   Headers                 Next.js `await headers()`
//   { request }             SvelteKit RequestEvent, Astro APIContext
//   { req: { raw } }        Hono Context
//   { node: { req } }       h3 / Nuxt / Nitro H3Event
//   { headers: {...} }      Node http, Express, Connect, Fastify, Koa ctx/request, Tylix

function isHeaders(value) {
  return value != null && typeof value.get === 'function' && typeof value.has === 'function'
}

/** Unwraps a framework event/context to the object that carries headers. */
export function unwrapRequest(input) {
  if (input == null) throw new TypeError('Expected a request')
  if (isHeaders(input)) return { headers: input }
  if (typeof Request !== 'undefined' && input instanceof Request) return input
  if (input.req?.raw) return input.req.raw // Hono
  if (typeof Request !== 'undefined' && input.req instanceof Request) return input.req // h3 v2
  if (input.request && (input.request.headers || input.request instanceof Request)) {
    // SvelteKit/Astro carry a Web Request; Koa's ctx.request carries
    // Node headers. Either way the inner object is the request.
    return input.request
  }
  if (input.node?.req) return input.node.req // h3
  return input
}

export function getHeader(input, name) {
  const req = unwrapRequest(input)
  const headers = req.headers
  if (!headers) return null
  if (isHeaders(headers)) return headers.get(name)
  const value = headers[name.toLowerCase()] ?? headers[name]
  if (Array.isArray(value)) return value.join(name.toLowerCase() === 'cookie' ? '; ' : ', ')
  return value == null ? null : String(value)
}

export function getMethod(input) {
  const req = unwrapRequest(input)
  return String(req.method ?? 'GET').toUpperCase()
}

/** All values per cookie name, straight from the Cookie header. */
export function getCookiesAll(input) {
  return parseCookieHeaderAll(getHeader(input, 'cookie'))
}

/** First value of one cookie, or null. */
export function getCookie(input, name) {
  return getCookiesAll(input)[name]?.[0] ?? null
}

function firstForwarded(value) {
  return value ? String(value).split(',')[0].trim() : null
}

/**
 * Whether the request arrived over HTTPS. X-Forwarded-Proto is only
 * believed with trustProxy, since any client can send it.
 */
export function isSecureRequest(input, { trustProxy = false } = {}) {
  const req = unwrapRequest(input)
  if (trustProxy) {
    const proto = firstForwarded(getHeader(req, 'x-forwarded-proto'))
    if (proto) return proto === 'https'
  }
  if (typeof req.url === 'string' && /^https:/i.test(req.url)) return true
  if (req.secure === true || req.protocol === 'https') return true
  if (req.socket?.encrypted || req.connection?.encrypted) return true
  return false
}

export function getHost(input, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = firstForwarded(getHeader(input, 'x-forwarded-host'))
    if (forwarded) return forwarded.toLowerCase()
  }
  const req = unwrapRequest(input)
  const host = getHeader(req, 'host')
  if (host) return host.toLowerCase()
  if (typeof req.url === 'string' && /^https?:\/\//i.test(req.url)) {
    try {
      return new URL(req.url).host.toLowerCase()
    } catch {}
  }
  return null
}

/** The path of the request (no query string). */
export function getPathname(input) {
  const req = unwrapRequest(input)
  const raw = req.originalUrl ?? req.url ?? '/'
  try {
    return new URL(raw, 'http://localhost').pathname
  } catch {
    return '/'
  }
}

export function getSearchParam(input, name) {
  const req = unwrapRequest(input)
  const raw = req.originalUrl ?? req.url ?? '/'
  try {
    return new URL(raw, 'http://localhost').searchParams.get(name)
  } catch {
    return null
  }
}

/**
 * The client's IP. Proxy headers are only read with trustProxy (a client
 * can put anything there). Falls back to the socket address, or an IP a
 * framework already resolved (Express req.ip, Fastify request.ip).
 */
export function getClientIp(input, { trustProxy = false } = {}) {
  const req = unwrapRequest(input)
  if (trustProxy) {
    const candidates = [
      getHeader(req, 'cf-connecting-ip'),
      getHeader(req, 'x-real-ip'),
      firstForwarded(getHeader(req, 'x-forwarded-for')),
    ]
    for (const ip of candidates) if (ip) return ip.trim()
  }
  return req.ip ?? req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? input?.clientAddress ?? 'unknown'
}

// --- writing cookies back ------------------------------------------------

/**
 * Adds Set-Cookie headers to whatever the framework uses as a response:
 * Headers, a Web Response, Node/Express res, Fastify reply, Koa ctx,
 * Hono context or an h3 event. Returns the target for chaining.
 */
export function applyCookies(target, cookies) {
  const list = (Array.isArray(cookies) ? cookies : [cookies]).filter(Boolean)
  if (list.length === 0 || target == null) return target

  if (isHeaders(target)) {
    for (const c of list) target.append('Set-Cookie', c)
    return target
  }
  if (target.headers && isHeaders(target.headers) && typeof target.status === 'number' && !target.setHeader) {
    for (const c of list) target.headers.append('Set-Cookie', c) // Web Response
    return target
  }
  if (target.req?.raw && typeof target.header === 'function') {
    for (const c of list) target.header('Set-Cookie', c, { append: true }) // Hono
    return target
  }
  if (target.node?.res) return applyCookies(target.node.res, list) // h3 v1
  if (target.res?.headers && isHeaders(target.res.headers)) {
    for (const c of list) target.res.headers.append('Set-Cookie', c) // h3 v2
    return target
  }
  if (typeof target.append === 'function' && target.res) {
    for (const c of list) target.append('Set-Cookie', c) // Koa ctx
    return target
  }
  // Node res, Express res, Fastify reply (getHeader/header or setHeader).
  const get = target.getHeader?.bind(target)
  const existing = get ? get('set-cookie') : undefined
  const merged = [...(existing == null ? [] : Array.isArray(existing) ? existing : [String(existing)]), ...list]
  if (typeof target.setHeader === 'function') target.setHeader('Set-Cookie', merged)
  else if (typeof target.header === 'function') target.header('set-cookie', merged)
  else throw new TypeError('applyCookies: unrecognised response object')
  return target
}

/** A Headers object holding the given Set-Cookie values. */
export function cookieHeaders(cookies, init) {
  const headers = new Headers(init)
  for (const c of cookies ?? []) headers.append('Set-Cookie', c)
  return headers
}
