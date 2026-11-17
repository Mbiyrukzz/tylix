// A store on the Tylix ORM, so roles live in the app's own database on any
// of its SQL drivers (SQLite, PostgreSQL, MySQL, MariaDB, CockroachDB).
//
//   import { Model } from '@tylix/orm'
//   const store = ormStore({ Model })
//
// Tables (created by createPermissionTables, see ./schema.js):
//   permissions            id, name, description, timestamps
//   roles                  id, name, description, timestamps
//   role_has_permissions   id, role, permission     (permission may be a pattern or !deny)
//   role_inherits          id, role, parent
//   model_has_roles        id, subject_type, subject_id, role, team, expires_at
//   model_has_permissions  id, subject_type, subject_id, permission, effect, team, expires_at
//
// Pivot rows refer to roles and permissions by name, not id: a grant can be
// a pattern ("posts.*") that has no row of its own, and reads need no joins.
export const DEFAULT_TABLES = Object.freeze({
  permissions: 'permissions',
  roles: 'roles',
  roleHasPermissions: 'role_has_permissions',
  roleInherits: 'role_inherits',
  modelHasRoles: 'model_has_roles',
  modelHasPermissions: 'model_has_permissions',
})

export function ormStore({ Model, tables = {} } = {}) {
  if (typeof Model !== 'function') {
    throw new TypeError('ormStore({ Model }) needs the Model class from @tylix/orm.')
  }
  const t = { ...DEFAULT_TABLES, ...tables }
  const model = (table, fillable, timestamps) =>
    class extends Model {
      static table = table
      static fillable = fillable
      static timestamps = timestamps
    }

  const Permission = model(t.permissions, ['name', 'description'], true)
  const Role = model(t.roles, ['name', 'description'], true)
  const RolePermission = model(t.roleHasPermissions, ['role', 'permission'], false)
  const RoleInherit = model(t.roleInherits, ['role', 'parent'], false)
  const SubjectRole = model(t.modelHasRoles, ['subject_type', 'subject_id', 'role', 'team', 'expires_at'], false)
  const SubjectPermission = model(
    t.modelHasPermissions,
    ['subject_type', 'subject_id', 'permission', 'effect', 'team', 'expires_at'],
    false,
  )

  const run = (sql, params) => Model.getAdapter().run(sql, params)
  const subjectWhere = (M, ref) => M.where('subject_type', ref.type).where('subject_id', String(ref.id))
  const iso = (value) => (value ? new Date(value).toISOString() : null)

  return {
    models: { Permission, Role, RolePermission, RoleInherit, SubjectRole, SubjectPermission },

    async loadCatalog() {
      const [permissions, roles, grants, inherits] = await Promise.all([
        Permission.query().orderBy('name').get(),
        Role.query().orderBy('name').get(),
        RolePermission.query().get(),
        RoleInherit.query().get(),
      ])
      return {
        permissions: permissions.map((p) => ({ name: p.name, description: p.description ?? null })),
        roles: roles.map((r) => ({
          name: r.name,
          description: r.description ?? null,
          permissions: grants.filter((g) => g.role === r.name).map((g) => g.permission),
          inherits: inherits.filter((i) => i.role === r.name).map((i) => i.parent),
        })),
      }
    },

    async savePermission({ name, description = null }) {
      const existing = await Permission.where('name', name).first()
      if (!existing) await Permission.create({ name, description })
      else if (description !== null && description !== existing.description) await Permission.update(existing.id, { description })
    },

    async deletePermission(name) {
      await run(`DELETE FROM ${t.permissions} WHERE name = ?`, [name])
      await run(`DELETE FROM ${t.roleHasPermissions} WHERE permission = ? OR permission = ?`, [name, `!${name}`])
      await run(`DELETE FROM ${t.modelHasPermissions} WHERE permission = ?`, [name])
    },

    async saveRole({ name, description = null, permissions = [], inherits = [] }) {
      const existing = await Role.where('name', name).first()
      if (!existing) await Role.create({ name, description })
      else if (description !== existing.description) await Role.update(existing.id, { description })
      await run(`DELETE FROM ${t.roleHasPermissions} WHERE role = ?`, [name])
      for (const permission of new Set(permissions)) await RolePermission.create({ role: name, permission })
      await run(`DELETE FROM ${t.roleInherits} WHERE role = ?`, [name])
      for (const parent of new Set(inherits)) await RoleInherit.create({ role: name, parent })
    },

    async deleteRole(name) {
      await run(`DELETE FROM ${t.roles} WHERE name = ?`, [name])
      await run(`DELETE FROM ${t.roleHasPermissions} WHERE role = ?`, [name])
      await run(`DELETE FROM ${t.roleInherits} WHERE role = ? OR parent = ?`, [name, name])
      await run(`DELETE FROM ${t.modelHasRoles} WHERE role = ?`, [name])
    },

    async getAssignments(ref) {
      const [roles, permissions] = await Promise.all([subjectWhere(SubjectRole, ref).get(), subjectWhere(SubjectPermission, ref).get()])
      return {
        roles: roles.map((r) => ({ name: r.role, team: r.team ?? null, expiresAt: r.expires_at ?? null })),
        permissions: permissions.map((p) => ({
          name: p.permission,
          effect: p.effect === 'deny' ? 'deny' : 'allow',
          team: p.team ?? null,
          expiresAt: p.expires_at ?? null,
        })),
      }
    },

    async setAssignments(ref, { roles = [], permissions = [] }) {
      const id = String(ref.id)
      await run(`DELETE FROM ${t.modelHasRoles} WHERE subject_type = ? AND subject_id = ?`, [ref.type, id])
      for (const r of roles) {
        await SubjectRole.create({ subject_type: ref.type, subject_id: id, role: r.name, team: r.team ?? null, expires_at: iso(r.expiresAt) })
      }
      await run(`DELETE FROM ${t.modelHasPermissions} WHERE subject_type = ? AND subject_id = ?`, [ref.type, id])
      for (const p of permissions) {
        await SubjectPermission.create({
          subject_type: ref.type,
          subject_id: id,
          permission: p.name,
          effect: p.effect === 'deny' ? 'deny' : 'allow',
          team: p.team ?? null,
          expires_at: iso(p.expiresAt),
        })
      }
    },

    async subjectsWithRole(name) {
      const rows = await SubjectRole.where('role', name).get()
      return rows.map((r) => ({ type: r.subject_type, id: r.subject_id, team: r.team ?? null, expiresAt: r.expires_at ?? null }))
    },
  }
}
