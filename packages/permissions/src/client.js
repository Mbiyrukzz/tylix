// Checks for the browser (and anywhere else a user's access snapshot is at
// hand). No server, no store, no async: the server computes a snapshot once
// (permissions.access(user)) and sends it with the user, usually as
// user.access, and these answer from it synchronously.
//
//   import { can, hasRole } from '@tylix/permissions/client'
//   can(user, 'posts.edit')            // user.access, or a snapshot
//   hasRole(user, ['admin', 'editor']) // any of them
//
// The server stays the authority: hide a button with these, but guard the
// route that does the work with permissions.require() too.
import { allows, toAccess } from './match.js'

export { matches } from './match.js'

const list = (value) => (Array.isArray(value) ? value : [value])

// can(user, 'a')          -> may they do a?
// can(user, ['a', 'b'])   -> may they do both?
export function can(source, permission) {
  const access = toAccess(source)
  const wanted = list(permission)
  return wanted.length > 0 && wanted.every((p) => allows(access, p))
}

export function cannot(source, permission) {
  return !can(source, permission)
}

export function canAny(source, permissions) {
  const access = toAccess(source)
  return list(permissions).some((p) => allows(access, p))
}

export function canAll(source, permissions) {
  return can(source, permissions)
}

// hasRole(user, 'admin') or hasRole(user, ['admin', 'editor']) for any.
// Roles a role inherits count: an admin that inherits editor has editor.
export function hasRole(source, role) {
  const roles = toAccess(source).roles
  return list(role).some((r) => roles.includes(r))
}

export function hasAnyRole(source, roles) {
  return hasRole(source, roles)
}

export function hasAllRoles(source, roles) {
  const have = toAccess(source).roles
  const wanted = list(roles)
  return wanted.length > 0 && wanted.every((r) => have.includes(r))
}

// A bound checker over one snapshot, handy in templates:
//   const ability = createAbility(user.access)
//   ability.can('posts.edit')
export function createAbility(source) {
  const access = toAccess(source)
  return {
    roles: access.roles,
    permissions: access.permissions,
    denied: access.denied,
    superAdmin: access.superAdmin,
    can: (p) => can(access, p),
    cannot: (p) => !can(access, p),
    canAny: (ps) => canAny(access, ps),
    canAll: (ps) => canAll(access, ps),
    hasRole: (r) => hasRole(access, r),
    hasAnyRole: (rs) => hasAnyRole(access, rs),
    hasAllRoles: (rs) => hasAllRoles(access, rs),
    // Every listed permission name this snapshot allows, for menus:
    //   ability.allowed(['posts.create', 'users.view'])
    allowed: (ps) => list(ps).filter((p) => allows(access, p)),
  }
}

// Shorthand for directive-style checks: "posts.edit", "role:admin",
// "any:a|b", "all:a|b". Used by the framework bindings so a template can
// pass one string.
export function check(source, expression) {
  if (Array.isArray(expression)) return can(source, expression)
  const text = String(expression ?? '').trim()
  if (text.startsWith('role:')) return hasRole(source, text.slice(5).split('|').map((s) => s.trim()))
  if (text.startsWith('any:')) return canAny(source, text.slice(4).split('|').map((s) => s.trim()))
  if (text.startsWith('all:')) return can(source, text.slice(4).split('|').map((s) => s.trim()))
  return can(source, text)
}

// Re-exported so the engine and bindings share one notion of "a snapshot".
export { toAccess }
