/** What a subject may do, as computed by the server. Safe to send to the browser. */
export interface Access {
  /** Every role the subject has, inherited roles included. */
  roles: string[]
  /** Granted permission names and patterns ("posts.*"). */
  permissions: string[]
  /** Denied names and patterns; a deny beats any allow. */
  denied: string[]
  /** True for the configured super-admin role: every check passes. */
  superAdmin: boolean
}

/** A snapshot, an object carrying one as `access` (a user), or nothing (a guest). */
export type AccessSource = Access | { access?: Access | null; [key: string]: unknown } | null | undefined

/** "posts.edit", ["a", "b"] (all), "role:admin|editor", "any:a|b", "all:a|b". */
export type Requirement = string | string[]

export interface Ability extends Access {
  can(permission: string | string[]): boolean
  cannot(permission: string | string[]): boolean
  canAny(permissions: string[]): boolean
  canAll(permissions: string[]): boolean
  hasRole(role: string | string[]): boolean
  hasAnyRole(roles: string[]): boolean
  hasAllRoles(roles: string[]): boolean
  /** The listed permissions this snapshot allows. */
  allowed(permissions: string[]): string[]
}

export function can(source: AccessSource, permission: string | string[]): boolean
export function cannot(source: AccessSource, permission: string | string[]): boolean
export function canAny(source: AccessSource, permissions: string | string[]): boolean
export function canAll(source: AccessSource, permissions: string | string[]): boolean
export function hasRole(source: AccessSource, role: string | string[]): boolean
export function hasAnyRole(source: AccessSource, roles: string | string[]): boolean
export function hasAllRoles(source: AccessSource, roles: string | string[]): boolean
export function createAbility(source: AccessSource): Ability
export function check(source: AccessSource, requirement: Requirement): boolean
export function toAccess(source: AccessSource): Access
/** True when `grant` (which may use * and a,b) covers `requested`. */
export function matches(grant: string, requested: string): boolean
