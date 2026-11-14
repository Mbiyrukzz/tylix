import { getHeader, getHost, getMethod } from './request.js'

// CSRF protection without tokens, the way modern browsers make possible:
// every browser request is labelled with Sec-Fetch-Site (and Origin on
// writes). Those headers cannot be set by page JavaScript, so a write
// from another site is recognisable and refused. Requests with neither
// header (curl, server-to-server, webhooks) carry no ambient browser
// cookies by accident and are not CSRF; they pass.
//
// Combined with SameSite=Lax cookies this blocks cross-site and
// same-site (sibling subdomain) forgeries alike.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function originOf(value) {
  if (!value || value === 'null') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * True when the request is a state-changing browser request from a site
 * other than this one (or a trusted origin). Use it to refuse the request.
 */
export function isCrossSiteRequest(input, { trustedOrigins = [], trustProxy = false, allowSafeMethods = true } = {}) {
  if (allowSafeMethods && SAFE_METHODS.has(getMethod(input))) return false

  const site = getHeader(input, 'sec-fetch-site')
  const originHeader = getHeader(input, 'origin')
  if (!site && !originHeader) return false
  if (site === 'same-origin' || site === 'none') return false

  const origin = originOf(originHeader)
  if (!origin) return true
  const trusted = new Set(trustedOrigins.map((o) => originOf(o)).filter(Boolean))
  if (trusted.has(origin)) return false

  // Same-site (a sibling subdomain) is NOT trusted unless listed: a
  // compromised or user-controlled subdomain must not be able to act.
  if (site === 'same-site' || site === 'cross-site') return true

  // No Sec-Fetch-Site (older browser): compare Origin with Host.
  const host = getHost(input, { trustProxy })
  return !host || new URL(origin).host !== host
}

/**
 * Only allows relative, same-site paths as redirect targets: "/dashboard?x=1"
 * yes; "https://evil.example", "//evil.example", "/\\evil.example",
 * "javascript:..." no. Use it for every ?next= / returnTo value.
 */
export function safeRedirectPath(value, fallback = '/') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    const url = new URL(value, 'http://localhost')
    if (url.origin !== 'http://localhost') return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}
