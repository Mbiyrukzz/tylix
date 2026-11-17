// Permission names and how grants match them. Shared by the server engine
// and the browser helpers, so a check gives the same answer on both sides.
//
// A name is dot-separated segments: "posts.edit", "billing.invoices.export".
// A grant (what a role or user is given) may also use:
//
//   *               every permission
//   posts.*         everything under posts: posts.edit, posts.edit.own, ...
//   posts.*.own     exactly one segment in the middle: posts.edit.own
//   posts.edit,delete   either of the listed segments
//   !posts.delete   a deny, only inside role definitions (see the engine)
//
// A trailing * matches one or more segments; a * anywhere else matches
// exactly one. Matching is case-sensitive, like the names you define.

const cache = new Map()

function compile(grant) {
  let compiled = cache.get(grant)
  if (compiled) return compiled
  const segments = grant.split('.').map((s) => (s === '*' ? '*' : s.includes(',') ? s.split(',').map((x) => x.trim()) : s))
  compiled = segments
  if (cache.size > 5000) cache.clear()
  cache.set(grant, compiled)
  return compiled
}

// True when `grant` covers the `requested` permission. A requested name
// that itself contains * is only covered by a grant at least as broad
// (a check for "posts.*" asks "may they do everything under posts?").
export function matches(grant, requested) {
  if (typeof grant !== 'string' || typeof requested !== 'string') return false
  if (grant === requested || grant === '*') return true
  const g = compile(grant)
  const r = requested.split('.')
  for (let i = 0; i < g.length; i++) {
    const seg = g[i]
    const last = i === g.length - 1
    if (seg === '*') {
      if (i >= r.length) return false
      if (last) return true
      if (r[i] === '') return false
      continue
    }
    if (i >= r.length) return false
    if (Array.isArray(seg)) {
      if (!seg.includes(r[i])) return false
    } else if (seg !== r[i]) {
      return false
    }
  }
  return g.length === r.length
}

export function isPattern(name) {
  return typeof name === 'string' && (name.includes('*') || name.includes(','))
}

const NAME = /^!?[A-Za-z0-9_\-:*,]+(\.[A-Za-z0-9_\-:*,]+)*$/

export function assertName(name, what = 'permission') {
  if (typeof name !== 'string' || !NAME.test(name.trim())) {
    throw new TypeError(
      `Invalid ${what} name ${JSON.stringify(name)}. Use dot-separated words, like "posts.edit" (letters, digits, - _ : and the * wildcard).`,
    )
  }
  return name.trim()
}

const EMPTY = Object.freeze({ roles: [], permissions: [], denied: [], superAdmin: false })

// Accepts what a check is handed: an access snapshot, a user carrying one
// as `access`, or nothing (a guest).
export function toAccess(source) {
  if (!source || typeof source !== 'object') return EMPTY
  const access = Array.isArray(source.permissions) || Array.isArray(source.roles) ? source : source.access
  if (!access || typeof access !== 'object') return EMPTY
  return {
    roles: Array.isArray(access.roles) ? access.roles : [],
    permissions: Array.isArray(access.permissions) ? access.permissions : [],
    denied: Array.isArray(access.denied) ? access.denied : [],
    superAdmin: access.superAdmin === true,
  }
}

// The decision for one permission against an access snapshot: a super
// admin may do anything, a matching deny always wins over an allow.
export function allows(access, permission) {
  if (access.superAdmin) return true
  for (const d of access.denied) if (matches(d, permission)) return false
  for (const p of access.permissions) if (matches(p, permission)) return true
  return false
}
