// HTTP guards. The (req, res, next) form works in Tylix routes, Express,
// Connect, Polka and Fastify (via middie); guardRequest() works with any
// framework built on the web Request (Hono, Next.js route handlers,
// SvelteKit, Remix, Astro, Workers).
//
// Tylix:   router.post('/api/posts', permissions.middleware('posts.create'), handler)
// Express: app.delete('/posts/:id', permissions.middleware('posts.delete'), handler)
// Hono:    const denied = await guardRequest(permissions, user, 'posts.create'); if (denied) return denied
//
// A requirement is one of:
//   'posts.edit'                       that permission
//   ['posts.edit', 'posts.publish']    all of them
//   { any: ['posts.edit', 'posts.own'] }
//   { role: 'admin' } / { role: ['admin', 'editor'] }   any of the roles
//   { permission, role }               both must pass
//   (req) => boolean | Promise<boolean>
export const PERMISSION_MARK = Symbol.for('tylix.permission')

const list = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])

export function describeRequirement(requirement) {
  if (typeof requirement === 'string') return requirement
  if (Array.isArray(requirement)) return requirement.join(' + ')
  if (typeof requirement === 'function') return 'custom check'
  const parts = []
  if (requirement?.permission) parts.push(list(requirement.permission).join(' + '))
  if (requirement?.any) parts.push(`any of ${list(requirement.any).join(', ')}`)
  if (requirement?.role) parts.push(`role ${list(requirement.role).join(' | ')}`)
  return parts.join(', ') || 'permission'
}

// Resolves one requirement for one subject. Exported so other adapters
// (and the Tylix page guard) share the exact semantics.
export async function satisfies(permissions, subject, requirement, { resource, team, req } = {}) {
  if (!subject) return false
  const opts = { team }
  if (typeof requirement === 'string' || Array.isArray(requirement)) {
    return permissions.can(subject, requirement, resource, opts)
  }
  if (typeof requirement === 'function') return Boolean(await requirement(req, { subject, permissions }))
  if (!requirement || typeof requirement !== 'object') return false
  if (requirement.permission && !(await permissions.can(subject, requirement.permission, resource, opts))) return false
  if (requirement.all && !(await permissions.can(subject, requirement.all, resource, opts))) return false
  if (requirement.any && !(await permissions.canAny(subject, requirement.any, resource, opts))) return false
  if (requirement.role && !(await permissions.hasRole(subject, requirement.role, opts))) {
    // A super admin passes role checks too.
    const access = await permissions.access(subject, opts)
    if (!access.superAdmin) return false
  }
  return true
}

const defaultUser = (req) => req.user ?? req.auth?.user ?? req.session?.user ?? req.locals?.user ?? null

function send(res, status, body) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const r = res.status(status)
    return (r && typeof r.json === 'function' ? r : res).json(body)
  }
  res.statusCode = status
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function middleware(permissions, requirement, options = {}) {
  const {
    user = defaultUser,
    team = () => null,
    resource,
    message = 'You do not have permission to do that.',
    onDenied,
  } = options
  const label = describeRequirement(requirement)

  const fn = async (req, res, next) => {
    const subject = await user(req)
    if (!subject) return send(res, 401, { error: 'Not authenticated.' })
    let ok
    try {
      ok = await satisfies(permissions, subject, requirement, {
        req,
        team: await team(req),
        resource: resource ? await resource(req) : undefined,
      })
    } catch (err) {
      console.error('[permissions] check failed:', err)
      return send(res, 500, { error: "Couldn't check your permissions." })
    }
    if (!ok) {
      if (onDenied) return onDenied(req, res, { requirement })
      return send(res, 403, { error: message, required: label })
    }
    if (typeof next === 'function') return next()
  }
  fn[PERMISSION_MARK] = label
  return fn
}

// Handler-wrapping form, like requireAuth: permissions.guard(handler, 'posts.edit')
export function guard(permissions, handler, requirement, options = {}) {
  const check = middleware(permissions, requirement, options)
  const wrapped = (req, res) => check(req, res, () => handler(req, res))
  wrapped[PERMISSION_MARK] = check[PERMISSION_MARK]
  return wrapped
}

// For web Request frameworks: returns null when allowed, or a 401/403
// Response to return as is.
export async function guardRequest(permissions, subject, requirement, { resource, team, message } = {}) {
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  if (!subject) return json(401, { error: 'Not authenticated.' })
  const ok = await satisfies(permissions, subject, requirement, { resource, team })
  return ok ? null : json(403, { error: message ?? 'You do not have permission to do that.', required: describeRequirement(requirement) })
}
