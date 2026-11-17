// @tylix/permissions: roles and permissions for any JavaScript app.
import { createPermissions as createEngine, PermissionError, ForbiddenError } from './engine.js'
import { middleware, guard, guardRequest, satisfies, describeRequirement, PERMISSION_MARK } from './http.js'

export { PermissionError, ForbiddenError }
export { memoryStore } from './stores/memory.js'
export { ormStore, DEFAULT_TABLES } from './stores/orm.js'
export { matches, isPattern } from './match.js'
export { can, cannot, canAny, canAll, hasRole, hasAnyRole, hasAllRoles, createAbility, check, toAccess } from './client.js'
export { guardRequest, satisfies, describeRequirement, PERMISSION_MARK }

export function createPermissions(options = {}) {
  const permissions = createEngine(options)
  // HTTP helpers bound to this instance.
  permissions.middleware = (requirement, opts) => middleware(permissions, requirement, opts)
  permissions.require = permissions.middleware
  permissions.guard = (handler, requirement, opts) => guard(permissions, handler, requirement, opts)
  permissions.guardRequest = (subject, requirement, opts) => guardRequest(permissions, subject, requirement, opts)
  return permissions
}
