// Angular helpers, as signals. Provide where the signed-in user comes from:
//
//   // app.config.ts
//   providers: [providePermissions(() => injectAuth().user)]
//
//   // a component
//   can = injectCan()
//   @if (can('posts.create')) { <app-new-post /> }
//
//   // routes
//   { path: 'admin', canActivate: [permissionGuard('role:admin')], ... }
import { InjectionToken, computed, inject } from '@angular/core'
import { Router } from '@angular/router'
import { createAbility, check } from './client.js'

// A signal (or any function) returning the user or access snapshot.
export const TYLIX_PERMISSIONS_SOURCE = new InjectionToken('TYLIX_PERMISSIONS_SOURCE')

export function providePermissions(factory) {
  return { provide: TYLIX_PERMISSIONS_SOURCE, useFactory: factory }
}

function source() {
  const read = inject(TYLIX_PERMISSIONS_SOURCE, { optional: true })
  return typeof read === 'function' ? read : () => read ?? null
}

export function injectAbility() {
  const read = source()
  return computed(() => createAbility(read()))
}

// can('posts.edit'), can(['a', 'b']), can('role:admin'), can('any:a|b').
// Reads the user signal, so templates update when the session changes.
export function injectCan() {
  const read = source()
  return (requirement) => check(read(), requirement)
}

export function permissionGuard(requirement, { redirectTo = '/' } = {}) {
  return () => {
    const read = source()
    return check(read(), requirement) ? true : inject(Router).parseUrl(redirectTo)
  }
}
