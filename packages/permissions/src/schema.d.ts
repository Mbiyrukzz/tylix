export interface PermissionTables {
  permissions?: string
  roles?: string
  roleHasPermissions?: string
  roleInherits?: string
  modelHasRoles?: string
  modelHasPermissions?: string
}
export const DEFAULT_TABLES: Readonly<Required<PermissionTables>>
/** Creates the six tables ormStore reads. `schema` is the Tylix migration schema. */
export function createPermissionTables(schema: unknown, tables?: PermissionTables): Promise<void>
export function dropPermissionTables(schema: unknown, tables?: PermissionTables): Promise<void>
