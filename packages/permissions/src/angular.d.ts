import type { InjectionToken, Provider, Signal } from '@angular/core'
import type { CanActivateFn } from '@angular/router'
import type { Ability, AccessSource, Requirement } from './client.js'
export const TYLIX_PERMISSIONS_SOURCE: InjectionToken<() => AccessSource>
export function providePermissions(factory: () => (() => AccessSource) | AccessSource): Provider
export function injectAbility(): Signal<Ability>
export function injectCan(): (requirement: Requirement) => boolean
export function permissionGuard(requirement: Requirement, options?: { redirectTo?: string }): CanActivateFn
