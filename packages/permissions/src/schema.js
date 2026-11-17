// The tables ormStore reads, for a Tylix migration:
//
//   import { createPermissionTables, dropPermissionTables } from '@tylix/permissions/schema'
//   export const up = (schema) => createPermissionTables(schema)
//   export const down = (schema) => dropPermissionTables(schema)
import { DEFAULT_TABLES } from './stores/orm.js'

export { DEFAULT_TABLES }

export async function createPermissionTables(schema, tables = {}) {
  const t = { ...DEFAULT_TABLES, ...tables }

  await schema.createTable(t.permissions, (table) => {
    table.increments('id')
    table.string('name').unique()
    table.string('description').nullable()
    table.timestamps()
  })

  await schema.createTable(t.roles, (table) => {
    table.increments('id')
    table.string('name').unique()
    table.string('description').nullable()
    table.timestamps()
  })

  await schema.createTable(t.roleHasPermissions, (table) => {
    table.increments('id')
    table.string('role').index()
    table.string('permission').index()
  })

  await schema.createTable(t.roleInherits, (table) => {
    table.increments('id')
    table.string('role').index()
    table.string('parent').index()
  })

  await schema.createTable(t.modelHasRoles, (table) => {
    table.increments('id')
    table.string('subject_type')
    table.string('subject_id')
    table.string('role').index()
    table.string('team').nullable()
    table.datetime('expires_at').nullable()
    table.index(['subject_type', 'subject_id'])
  })

  await schema.createTable(t.modelHasPermissions, (table) => {
    table.increments('id')
    table.string('subject_type')
    table.string('subject_id')
    table.string('permission').index()
    table.string('effect').default('allow')
    table.string('team').nullable()
    table.datetime('expires_at').nullable()
    table.index(['subject_type', 'subject_id'])
  })
}

export async function dropPermissionTables(schema, tables = {}) {
  const t = { ...DEFAULT_TABLES, ...tables }
  for (const name of [t.modelHasPermissions, t.modelHasRoles, t.roleInherits, t.roleHasPermissions, t.roles, t.permissions]) {
    await schema.dropTable(name)
  }
}
