import type { Access, Ability, AccessSource } from './client.js'
import type { PermissionTables } from './schema.js'

export * from './client.js'
export { DEFAULT_TABLES } from './schema.js'

/** A user row, a Tylix req.user ({ userId }), an id, or { type, id } for other subjects. */
export type Subject =
  | string
  | number
  | { id?: unknown; userId?: unknown; sub?: unknown; type?: string; subjectType?: string; [key: string]: unknown }

export interface ScopeOptions {
  /** Team or tenant. Assignments without a team apply in every team. */
  team?: string | number | null
}
export interface GrantOptions extends ScopeOptions {
  /** When the grant stops applying. */
  expiresAt?: Date | string | number | null
}

export interface PermissionRecord {
  name: string
  description: string | null
}
export interface RoleRecord {
  name: string
  description: string | null
  /** Names, patterns, and "!name" denies. */
  permissions: string[]
  /** Roles whose permissions this one also has. */
  inherits: string[]
}
export interface Catalog {
  permissions: PermissionRecord[]
  roles: RoleRecord[]
}

export interface Assignment {
  name: string
  team: string | null
  expiresAt: string | Date | null
}
export interface Assignments {
  roles: Assignment[]
  permissions: (Assignment & { effect: 'allow' | 'deny' })[]
}

/** Where roles live. Implement it to keep them in any database. */
export interface PermissionStore {
  loadCatalog(): Promise<Catalog>
  savePermission(permission: { name: string; description?: string | null }): Promise<void>
  /** Also removes it from roles and subjects. */
  deletePermission(name: string): Promise<void>
  saveRole(role: RoleRecord): Promise<void>
  /** Also removes its assignments and inherits. */
  deleteRole(name: string): Promise<void>
  getAssignments(subject: { type: string; id: string }): Promise<Assignments>
  setAssignments(subject: { type: string; id: string }, assignments: Assignments): Promise<void>
  subjectsWithRole(name: string): Promise<{ type: string; id: string; team: string | null; expiresAt: string | null }[]>
}

/** Any cache with get/set(ttlSeconds)/forget, like Tylix's `cache` or a Redis wrapper. */
export interface PermissionCache {
  get(key: string): Promise<any>
  set(key: string, value: any, ttlSeconds?: number | null): Promise<unknown>
  forget?(key: string): Promise<unknown>
  delete?(key: string): Promise<unknown>
}

export interface RuleContext<R = any, S = Subject> {
  subject: S
  user: S
  resource: R
  /** Whether stored permissions grant it. */
  granted: boolean
  access: Access
  team: string | number | null
  /** Another check for the same subject (and, by default, resource). */
  can(permission: string | string[], resource?: unknown): Promise<boolean>
}
export type Rule<R = any> = (context: RuleContext<R>) => boolean | Promise<boolean>

export interface PermissionsOptions {
  store?: PermissionStore
  /** Role name(s) that pass every check. */
  superAdmin?: string | string[] | null
  /** Resource rules: decide can(user, name, resource). */
  rules?: Record<string, Rule>
  /** Shared cache, so every process sees changes at once. */
  cache?: PermissionCache | null
  /** Seconds a snapshot is cached. Default 30. */
  ttl?: number
  /** Subject type for plain ids and users. Default "user". */
  subjectType?: string
  /** Refuse to grant names that weren't created (patterns excepted). Default true. */
  strict?: boolean
  /** Roles every signed-in subject has without an assignment. Guests get none. */
  defaultRoles?: string[]
}

export type HttpRequirement =
  | string
  | string[]
  | { permission?: string | string[]; all?: string[]; any?: string[]; role?: string | string[] }
  | ((req: any, context: { subject: Subject; permissions: Permissions }) => boolean | Promise<boolean>)

export interface MiddlewareOptions {
  /** Default: req.user, req.auth.user, req.session.user or req.locals.user. */
  user?: (req: any) => Subject | null | undefined | Promise<Subject | null | undefined>
  team?: (req: any) => string | number | null | Promise<string | number | null>
  resource?: (req: any) => unknown
  message?: string
  onDenied?: (req: any, res: any, info: { requirement: HttpRequirement }) => unknown
}

export interface SubjectPermissions {
  assignRole(roles: string | string[], options?: GrantOptions): Promise<SubjectPermissions>
  removeRole(roles: string | string[], options?: ScopeOptions): Promise<SubjectPermissions>
  syncRoles(roles: string[], options?: GrantOptions): Promise<SubjectPermissions>
  givePermission(permissions: string | string[], options?: GrantOptions): Promise<SubjectPermissions>
  /** An explicit deny: beats any allow from a role. */
  deny(permissions: string | string[], options?: GrantOptions): Promise<SubjectPermissions>
  revokePermission(permissions: string | string[], options?: ScopeOptions): Promise<SubjectPermissions>
  /** Replaces direct allows (denies are kept). */
  syncPermissions(permissions: string[], options?: GrantOptions): Promise<SubjectPermissions>
  can(permission: string | string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  cannot(permission: string | string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  canAny(permissions: string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  canAll(permissions: string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  hasRole(roles: string | string[], options?: ScopeOptions): Promise<boolean>
  hasAnyRole(roles: string[], options?: ScopeOptions): Promise<boolean>
  hasAllRoles(roles: string[], options?: ScopeOptions): Promise<boolean>
  roles(options?: ScopeOptions): Promise<string[]>
  permissions(options?: ScopeOptions): Promise<string[]>
  access(options?: ScopeOptions): Promise<Access>
  ability(options?: ScopeOptions): Promise<Ability>
  assignments(): Promise<Assignments>
  /** Throws ForbiddenError (status 403) when not allowed. */
  authorize(permission: string | string[], resource?: unknown, options?: ScopeOptions): Promise<void>
}

export interface RolePermissions {
  give(permissions: string | string[]): Promise<RolePermissions>
  deny(permissions: string | string[]): Promise<RolePermissions>
  revoke(permissions: string | string[]): Promise<RolePermissions>
  sync(permissions: string[]): Promise<RolePermissions>
  inherit(roles: string | string[]): Promise<RolePermissions>
  disinherit(roles: string | string[]): Promise<RolePermissions>
  get(): Promise<RoleRecord | null>
  access(): Promise<Access>
  subjects(): Promise<{ type: string; id: string; team: string | null; expiresAt: string | null }[]>
}

export interface SyncDefinition {
  permissions?: (string | { name: string; description?: string | null })[]
  roles?: Record<string, string | string[] | { permissions?: string[]; inherits?: string[]; description?: string | null }>
}

export interface Permissions {
  store: PermissionStore
  createPermission(name: string, options?: { description?: string | null }): Promise<PermissionRecord>
  createPermissions(names: (string | { name: string; description?: string | null })[]): Promise<PermissionRecord[]>
  findOrCreatePermission(name: string, options?: { description?: string | null }): Promise<PermissionRecord>
  deletePermission(name: string): Promise<void>
  createRole(name: string, options?: { description?: string | null; permissions?: string[]; inherits?: string[] }): Promise<RoleRecord>
  findOrCreateRole(name: string, options?: { description?: string | null; permissions?: string[]; inherits?: string[] }): Promise<RoleRecord>
  updateRole(name: string, options: { description?: string | null; permissions?: string[]; inherits?: string[] }): Promise<RoleRecord>
  deleteRole(name: string): Promise<void>
  findRole(name: string): Promise<RoleRecord | null>
  roles(): Promise<RoleRecord[]>
  listPermissions(): Promise<PermissionRecord[]>
  catalog(): Promise<Catalog>
  role(name: string): RolePermissions
  for(subject: Subject, scope?: ScopeOptions): SubjectPermissions
  user(subject: Subject, scope?: ScopeOptions): SubjectPermissions

  access(subject: Subject | null | undefined, options?: ScopeOptions): Promise<Access>
  can(subject: Subject | null | undefined, permission: string | string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  cannot(subject: Subject | null | undefined, permission: string | string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  canAny(subject: Subject | null | undefined, permissions: string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  canAll(subject: Subject | null | undefined, permissions: string[], resource?: unknown, options?: ScopeOptions): Promise<boolean>
  hasRole(subject: Subject, roles: string | string[], options?: ScopeOptions): Promise<boolean>
  hasAnyRole(subject: Subject, roles: string[], options?: ScopeOptions): Promise<boolean>
  hasAllRoles(subject: Subject, roles: string[], options?: ScopeOptions): Promise<boolean>
  authorize(subject: Subject | null | undefined, permission: string | string[], resource?: unknown, options?: ScopeOptions): Promise<void>
  ability(subject: Subject | null | undefined, options?: ScopeOptions): Promise<Ability>
  subjectsWithRole(name: string): Promise<{ type: string; id: string; team: string | null; expiresAt: string | null }[]>
  rule<R = any>(name: string, rule: Rule<R>): Permissions
  sync(definition: SyncDefinition, options?: { prune?: boolean }): Promise<Catalog>
  flush(): Promise<void>

  /** (req, res, next) middleware for Tylix routes, Express, Connect, Polka. */
  middleware(requirement: HttpRequirement, options?: MiddlewareOptions): (req: any, res: any, next?: () => unknown) => Promise<unknown>
  require(requirement: HttpRequirement, options?: MiddlewareOptions): (req: any, res: any, next?: () => unknown) => Promise<unknown>
  /** Wraps a (req, res) handler, like requireAuth. */
  guard<H extends (req: any, res: any) => unknown>(handler: H, requirement: HttpRequirement, options?: MiddlewareOptions): H
  /** For web Request frameworks: null when allowed, else a 401/403 Response. */
  guardRequest(subject: Subject | null | undefined, requirement: HttpRequirement, options?: { resource?: unknown; team?: string | number | null; message?: string }): Promise<Response | null>
  readonly options: { superAdmin: string | string[] | null; subjectType: string; ttl: number; strict: boolean; defaultRoles: string[] }
}

export function createPermissions(options?: PermissionsOptions): Permissions
export function memoryStore(initial?: Partial<Catalog>): PermissionStore
export function ormStore(options: { Model: any; tables?: PermissionTables }): PermissionStore & { models: Record<string, any> }
export function isPattern(name: string): boolean
export function guardRequest(permissions: Permissions, subject: Subject | null | undefined, requirement: HttpRequirement, options?: { resource?: unknown; team?: string | number | null; message?: string }): Promise<Response | null>
export function satisfies(permissions: Permissions, subject: Subject | null | undefined, requirement: HttpRequirement, options?: { resource?: unknown; team?: string | number | null; req?: unknown }): Promise<boolean>
export function describeRequirement(requirement: HttpRequirement): string
export const PERMISSION_MARK: unique symbol

export class PermissionError extends Error {
  code: 'ROLE_DOES_NOT_EXIST' | 'PERMISSION_DOES_NOT_EXIST' | 'ROLE_ALREADY_EXISTS' | 'ROLE_CYCLE' | 'INVALID_NAME' | 'NO_SUBJECT'
}
export class ForbiddenError extends Error {
  status: 403
  permission: string | string[] | null
}

export type { Access, Ability, AccessSource }
