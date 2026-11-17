// React helpers. Give the provider the signed-in user (with its access
// snapshot) or the snapshot itself, then check anywhere below it:
//
//   <PermissionsProvider user={useAuth().user}>
//     <Can permission="posts.create"><NewPostButton /></Can>
//     <Can role="admin" fallback={<p>Admins only.</p>}><AdminPanel /></Can>
//   </PermissionsProvider>
//
//   const canPublish = useCan('posts.publish')
import { createContext, createElement, Fragment, useContext, useMemo } from 'react'
import { createAbility, check, canAny } from './client.js'

const AbilityContext = createContext(createAbility(null))

export function PermissionsProvider({ user, access, children }) {
  const source = access ?? user ?? null
  const ability = useMemo(() => createAbility(source), [source])
  return createElement(AbilityContext.Provider, { value: ability }, children)
}

export function useAbility() {
  return useContext(AbilityContext)
}

// useCan('posts.edit'), useCan(['a', 'b']) for all, useCan('role:admin')
export function useCan(requirement) {
  const ability = useAbility()
  return check(ability, requirement)
}

export function useHasRole(role) {
  return useAbility().hasRole(role)
}

// <Can permission="a"> / permission={['a','b']} (all) / any={['a','b']} /
// role="admin" or role={['admin','editor']} (any) / not (inverts).
export function Can({ permission, any, role, not = false, fallback = null, children }) {
  const ability = useAbility()
  let ok = true
  if (permission !== undefined) ok = ok && ability.can(permission)
  if (any !== undefined) ok = ok && canAny(ability, any)
  if (role !== undefined) ok = ok && (ability.hasRole(role) || ability.superAdmin)
  if (not) ok = !ok
  return createElement(Fragment, null, ok ? children : fallback)
}
