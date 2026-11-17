// An in-memory store: tests, prototypes, and apps whose roles live in code.
// It is also the reference for the store contract: a store is any object
// with these async methods, so roles can live in Prisma, Drizzle, Mongo,
// Redis or a JSON file just as well.
//
//   loadCatalog()                 -> { permissions: [{ name, description }],
//                                      roles: [{ name, description, permissions: [], inherits: [] }] }
//   savePermission({ name, description })           upsert
//   deletePermission(name)        also drops it from roles and subjects
//   saveRole({ name, description, permissions, inherits })   upsert; lists replace
//   deleteRole(name)              also drops its assignments and inherits
//   getAssignments({ type, id })  -> { roles: [{ name, team, expiresAt }],
//                                      permissions: [{ name, effect, team, expiresAt }] }
//   setAssignments({ type, id }, { roles, permissions })   replaces both lists
//   subjectsWithRole(name)        -> [{ type, id, team, expiresAt }]
//
// Subject ids are compared as strings, so 7 and "7" are the same user.
const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)))
const keyOf = ({ type, id }) => `${type}:${String(id)}`

export function memoryStore(initial = {}) {
  const permissions = new Map()
  const roles = new Map()
  const subjects = new Map() // key -> { ref, roles, permissions }

  for (const p of initial.permissions ?? []) permissions.set(p.name, { name: p.name, description: p.description ?? null })
  for (const r of initial.roles ?? []) {
    roles.set(r.name, { name: r.name, description: r.description ?? null, permissions: [...(r.permissions ?? [])], inherits: [...(r.inherits ?? [])] })
  }

  return {
    async loadCatalog() {
      return { permissions: clone([...permissions.values()]), roles: clone([...roles.values()]) }
    },

    async savePermission({ name, description = null }) {
      const existing = permissions.get(name)
      permissions.set(name, { name, description: description ?? existing?.description ?? null })
    },

    async deletePermission(name) {
      permissions.delete(name)
      for (const role of roles.values()) {
        role.permissions = role.permissions.filter((p) => p !== name && p !== `!${name}`)
      }
      for (const entry of subjects.values()) {
        entry.permissions = entry.permissions.filter((p) => p.name !== name)
      }
    },

    async saveRole({ name, description = null, permissions: perms = [], inherits = [] }) {
      roles.set(name, { name, description, permissions: [...perms], inherits: [...inherits] })
    },

    async deleteRole(name) {
      roles.delete(name)
      for (const role of roles.values()) role.inherits = role.inherits.filter((r) => r !== name)
      for (const entry of subjects.values()) entry.roles = entry.roles.filter((r) => r.name !== name)
    },

    async getAssignments(ref) {
      const entry = subjects.get(keyOf(ref))
      return entry ? { roles: clone(entry.roles), permissions: clone(entry.permissions) } : { roles: [], permissions: [] }
    },

    async setAssignments(ref, { roles: r = [], permissions: p = [] }) {
      const key = keyOf(ref)
      if (r.length === 0 && p.length === 0) subjects.delete(key)
      else subjects.set(key, { ref: { type: ref.type, id: String(ref.id) }, roles: clone(r), permissions: clone(p) })
    },

    async subjectsWithRole(name) {
      const found = []
      for (const entry of subjects.values()) {
        for (const r of entry.roles) {
          if (r.name === name) found.push({ ...entry.ref, team: r.team ?? null, expiresAt: r.expiresAt ?? null })
        }
      }
      return found
    },
  }
}
