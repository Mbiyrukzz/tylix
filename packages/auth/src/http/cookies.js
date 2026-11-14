// Cookie parsing and serialisation with no dependencies (no cookie-parser).

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/

function decode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Every value of every cookie, in header order: { name: [value, ...] }.
 * Browsers send the most specific path first, and a name can repeat
 * (another path, or a cookie planted by a sibling subdomain), so security
 * code should look at all of them rather than whichever parsed last.
 */
export function parseCookieHeaderAll(header) {
  const out = Object.create(null)
  if (typeof header !== 'string' || header.length === 0) return out
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const name = pair.slice(0, eq).trim()
    if (!name || !TOKEN.test(name)) continue
    let value = pair.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1)
    ;(out[name] ??= []).push(decode(value))
  }
  return out
}

/** { name: value } using the first (most specific) value of each cookie. */
export function parseCookieHeader(header) {
  const all = parseCookieHeaderAll(header)
  const out = Object.create(null)
  for (const name in all) out[name] = all[name][0]
  return out
}

/**
 * One Set-Cookie header value. Secure-by-default: HttpOnly and
 * SameSite=Lax unless you say otherwise; SameSite=None forces Secure;
 * __Host- and __Secure- prefixes are checked against their rules so a
 * misconfiguration fails loudly instead of the browser silently
 * dropping the cookie.
 */
export function serializeCookie(name, value, options = {}) {
  const {
    maxAge,
    expires,
    path = '/',
    domain,
    secure = false,
    httpOnly = true,
    sameSite = 'lax',
    partitioned = false,
    priority,
  } = options

  if (!TOKEN.test(name)) throw new TypeError(`Invalid cookie name ${JSON.stringify(name)}`)
  const encoded = COOKIE_VALUE.test(value) ? value : encodeURIComponent(value)

  const site = String(sameSite).toLowerCase()
  if (!['lax', 'strict', 'none'].includes(site)) throw new TypeError(`Invalid sameSite ${JSON.stringify(sameSite)}`)
  const mustBeSecure = secure || site === 'none' || partitioned || name.startsWith('__Secure-') || name.startsWith('__Host-')
  if (name.startsWith('__Host-') && (domain || path !== '/')) {
    throw new TypeError(`${name}: __Host- cookies must have Path=/ and no Domain.`)
  }
  if (path && /[;\r\n]/.test(path)) throw new TypeError('Invalid cookie path')
  if (domain && !/^\.?[a-z0-9.-]+$/i.test(domain)) throw new TypeError('Invalid cookie domain')

  let cookie = `${name}=${encoded}`
  if (maxAge != null) cookie += `; Max-Age=${Math.max(0, Math.floor(maxAge))}`
  if (expires) cookie += `; Expires=${(expires instanceof Date ? expires : new Date(expires)).toUTCString()}`
  if (domain) cookie += `; Domain=${domain}`
  if (path) cookie += `; Path=${path}`
  if (httpOnly) cookie += '; HttpOnly'
  if (mustBeSecure) cookie += '; Secure'
  cookie += `; SameSite=${site[0].toUpperCase()}${site.slice(1)}`
  if (partitioned) cookie += '; Partitioned'
  if (priority) cookie += `; Priority=${priority}`
  return cookie
}

/** A Set-Cookie value that deletes the cookie (same name, path and domain). */
export function expireCookie(name, options = {}) {
  return serializeCookie(name, '', { ...options, maxAge: 0, expires: new Date(0) })
}
