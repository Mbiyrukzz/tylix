// Roles and permissions for any JavaScript app. Inspired by Laravel's
// spatie/laravel-permission, plus what it leaves to you:
//
//   - wildcards built in ("posts.*", "posts.edit,delete", "*")
//   - role inheritance (editor inherits writer)
//   - explicit denies that beat any allow ("!posts.delete" in a role, or
//     permissions.for(user).deny("posts.delete"))
//   - teams / tenants on every assignment, and assignments that expire
//   - rules for resource checks: can(user, "posts.update", post)
//   - one serializable snapshot (access) the browser checks synchronously
//   - a declarative sync() for seeders and config, idempotent
//   - storage you choose (memory, the Tylix ORM, or your own store)
//
// const permissions = createPermissions({ store: ormStore({ Model }), superAdmin: 'super-admin' })
// await permissions.createRole('editor', { permissions: ['posts.*'] })
// await permissions.for(user).assignRole('editor')
// await permissions.can(user, 'posts.publish')   // true
import { allows, assertName, isPattern, toAccess } from './match.js'
import { memoryStore } from './stores/memory.js'
import { createAbility } from './client.js'

export class PermissionError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'PermissionError'
    this.code = code
  }
}

// Thrown by authorize(); carries a 403 for HTTP layers.
export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.', permission = null) {
    super(message)
    this.name = 'ForbiddenError'
    this.status = 403
    this.permission = permission
  }
}

const list = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value.flat() : [value])
const uniq = (items) => [...new Set(items)]

function expired(entry, now) {
  if (!entry.expiresAt) return false
  const at = new Date(entry.expiresAt).getTime()
  return Number.isFinite(at) && at <= now
}

// What a check is handed as "the user": an id, a user row, a Tylix
// req.user ({ userId }), or { type, id } for things that aren't users
// (API clients, teams, devices).
function makeRef(subject, defaultType) {
  if (subject === null || subject === undefined) return null
  if (typeof subject === 'string' || typeof subject === 'number' || typeof subject === 'bigint') {
    return { type: defaultType, id: String(subject) }
  }
  if (typeof subject === 'object') {
    const id = subject.id ?? subject.userId ?? subject.sub ?? subject._id
    if (id === undefined || id === null) return null
    return { type: subject.subjectType ?? subject.type ?? defaultType, id: String(id) }
  }
  return null
}

function makeCache({ cache, ttl }) {
  // Shared cache (Tylix's cache, Redis, ...): get(key), set(key, value,
  // ttlSeconds), forget(key) or delete(key). Changes are seen by every
  // process at once through a version key.
  if (cache) {
    const forget = (cache.forget ?? cache.delete)?.bind(cache)
    const VERSION = 'tylix-permissions:version'
    let current = 'v0'
    const version = async () => {
      current = (await cache.get(VERSION)) ?? 'v0'
      return current
    }
    return {
      // Every read checks the version first, so a change made by another
      // process is seen on the next check.
      async get(key) {
        return cache.get(`tylix-permissions:${await version()}:${key}`)
      },
      async set(key, value) {
        await cache.set(`tylix-permissions:${current}:${key}`, value, ttl)
      },
      async bump() {
        if (forget) await forget(`tylix-permissions:${current}:catalog`)
        current = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        await cache.set(VERSION, current, null)
      },
    }
  }
  // In-process: entries live `ttl` seconds, so in a multi-process deploy
  // another worker's change is seen within that window. Pass a shared
  // cache to make it immediate.
  const entries = new Map()
  return {
    async get(key) {
      const hit = entries.get(key)
      if (!hit) return undefined
      if (hit.until < Date.now()) {
        entries.delete(key)
        return undefined
      }
      return hit.value
    },
    async set(key, value) {
      if (ttl > 0) entries.set(key, { value, until: Date.now() + ttl * 1000 })
    },
    async bump() {
      entries.clear()
    },
  }
}

export function createPermissions(options = {}) {
  const {
    store = memoryStore(),
    superAdmin = null,
    rules = {},
    cache: sharedCache = null,
    ttl = 30,
    subjectType = 'user',
    // Concrete names must exist before they're granted (catches typos);
    // patterns ("posts.*") never need a row.
    strict = true,
    // Roles every signed-in subject has without an assignment, e.g. a
    // "member" role with what any account may do. Guests get none.
    defaultRoles = [],
  } = options

  const cache = makeCache({ cache: sharedCache, ttl })
  const ruleMap = new Map(Object.entries(rules))

  const ref = (subject) => {
    const r = makeRef(subject, subjectType)
    if (!r) throw new PermissionError('A subject needs an id: pass a user, { id }, { userId } or an id.', 'NO_SUBJECT')
    return r
  }

  // ── Catalog ────────────────────────────────────────────────────────

  async function catalog() {
    const hit = await cache.get('catalog')
    if (hit) return hit
    const raw = await store.loadCatalog()
    const value = {
      permissions: raw.permissions.map((p) => ({ name: p.name, description: p.description ?? null })),
      roles: raw.roles.map((r) => ({
        name: r.name,
        description: r.description ?? null,
        permissions: uniq(r.permissions ?? []),
        inherits: uniq(r.inherits ?? []),
      })),
    }
    await cache.set('catalog', value)
    return value
  }

  async function changed() {
    await cache.bump()
  }

  async function findRole(name) {
    return (await catalog()).roles.find((r) => r.name === name) ?? null
  }

  async function requireRole(name) {
    const role = await findRole(name)
    if (!role) throw new PermissionError(`There is no role named "${name}". Create it first: permissions.createRole("${name}").`, 'ROLE_DOES_NOT_EXIST')
    return role
  }

  async function checkGrantable(names) {
    if (!strict) return
    const known = new Set((await catalog()).permissions.map((p) => p.name))
    for (const raw of names) {
      const name = raw.startsWith('!') ? raw.slice(1) : raw
      if (!isPattern(name) && !known.has(name)) {
        throw new PermissionError(
          `There is no permission named "${name}". Create it first: permissions.createPermission("${name}").`,
          'PERMISSION_DOES_NOT_EXIST',
        )
      }
    }
  }

  // Role names a set of roles expands to, through inheritance. Cycles are
  // harmless: each role is visited once.
  function expandRoles(names, roles) {
    const byName = new Map(roles.map((r) => [r.name, r]))
    const seen = new Set()
    const stack = [...names]
    while (stack.length) {
      const name = stack.pop()
      if (seen.has(name) || !byName.has(name)) continue
      seen.add(name)
      stack.push(...byName.get(name).inherits)
    }
    return [...seen]
  }

  async function createPermission(name, { description = null } = {}) {
    const clean = assertName(name)
    if (clean.startsWith('!')) throw new PermissionError('A permission name cannot start with "!"; that marks a deny inside a role.', 'INVALID_NAME')
    await store.savePermission({ name: clean, description })
    await changed()
    return { name: clean, description }
  }

  async function createPermissionsBulk(names) {
    const out = []
    for (const entry of list(names)) {
      const { name, description } = typeof entry === 'string' ? { name: entry } : entry
      out.push(await createPermission(name, { description }))
    }
    return out
  }

  async function deletePermission(name) {
    await store.deletePermission(name)
    await changed()
  }

  async function saveRole(name, { description, permissions, inherits }, { create }) {
    const clean = assertName(name, 'role')
    const existing = await findRole(clean)
    if (create && existing) throw new PermissionError(`A role named "${clean}" already exists.`, 'ROLE_ALREADY_EXISTS')
    if (!create && !existing) await requireRole(clean)
    const perms = permissions === undefined ? existing?.permissions ?? [] : uniq(list(permissions).map((p) => assertName(p)))
    const parents = inherits === undefined ? existing?.inherits ?? [] : uniq(list(inherits).map((r) => assertName(r, 'role')))
    await checkGrantable(perms)
    const cat = await catalog()
    for (const parent of parents) {
      if (parent === clean) throw new PermissionError(`Role "${clean}" cannot inherit itself.`, 'ROLE_CYCLE')
      if (!cat.roles.some((r) => r.name === parent)) await requireRole(parent)
      if (expandRoles([parent], cat.roles).includes(clean)) {
        throw new PermissionError(`Role "${clean}" cannot inherit "${parent}": "${parent}" already inherits "${clean}".`, 'ROLE_CYCLE')
      }
    }
    const role = {
      name: clean,
      description: description === undefined ? existing?.description ?? null : description,
      permissions: perms,
      inherits: parents,
    }
    await store.saveRole(role)
    await changed()
    return role
  }

  // ── Subjects (users, API clients, ...) ─────────────────────────────

  function activeFor(entries, team, now) {
    return entries.filter((e) => !expired(e, now) && (e.team == null || (team != null && String(e.team) === String(team))))
  }

  async function access(subject, { team = null } = {}) {
    const r = makeRef(subject, subjectType)
    if (!r) return { roles: [], permissions: [], denied: [], superAdmin: false }
    const key = `access:${r.type}:${r.id}:${team ?? ''}`
    const hit = await cache.get(key)
    if (hit) return hit

    const now = Date.now()
    const [cat, assigned] = await Promise.all([catalog(), store.getAssignments(r)])
    const roleNames = expandRoles(
      [...list(defaultRoles), ...activeFor(assigned.roles, team, now).map((x) => x.name)],
      cat.roles,
    ).sort()
    const allowed = []
    const denied = []
    for (const name of roleNames) {
      const role = cat.roles.find((x) => x.name === name)
      for (const p of role.permissions) (p.startsWith('!') ? denied : allowed).push(p.replace(/^!/, ''))
    }
    for (const p of activeFor(assigned.permissions, team, now)) (p.effect === 'deny' ? denied : allowed).push(p.name)

    const snapshot = {
      roles: roleNames,
      permissions: uniq(allowed).sort(),
      denied: uniq(denied).sort(),
      superAdmin: superAdmin != null && list(superAdmin).some((s) => roleNames.includes(s)),
    }
    // A snapshot with a pending expiry is only cached until then.
    const expiries = [...assigned.roles, ...assigned.permissions]
      .map((e) => (e.expiresAt ? new Date(e.expiresAt).getTime() : Infinity))
      .filter((at) => at > now)
    if (!expiries.some((at) => at - now < ttl * 1000)) await cache.set(key, snapshot)
    return snapshot
  }

  async function update(subject, change) {
    const r = ref(subject)
    const current = await store.getAssignments(r)
    const next = change({ roles: current.roles, permissions: current.permissions })
    await store.setAssignments(r, next)
    await changed()
  }

  const sameScope = (a, team) => String(a.team ?? '') === String(team ?? '')

  async function can(subject, permission, resource, opts) {
    ;[resource, opts] = splitArgs(resource, opts)
    const team = opts.team ?? null
    const snapshot = await access(subject, { team })
    const names = list(permission)
    if (names.length === 0) return false
    for (const name of names) {
      if (snapshot.superAdmin) continue
      const granted = allows(snapshot, name)
      const rule = ruleMap.get(name)
      if (rule && resource !== undefined) {
        const ok = await rule({
          subject,
          user: subject,
          resource,
          granted,
          access: snapshot,
          team,
          can: (other, res = resource) => can(subject, other, res, { team }),
        })
        if (!ok) return false
      } else if (!granted) {
        return false
      }
    }
    return true
  }

  // can(user, perm, { team }) with no resource: a plain object whose only
  // key is team is read as the options.
  function splitArgs(resource, opts) {
    if (opts === undefined && resource && typeof resource === 'object' && !Array.isArray(resource)) {
      const keys = Object.keys(resource)
      if (keys.length === 1 && keys[0] === 'team') return [undefined, resource]
    }
    return [resource, opts ?? {}]
  }

  function subjectApi(subject, { team: boundTeam = null } = {}) {
    const scope = (opts) => ({ team: opts?.team ?? boundTeam })
    const api = {
      async assignRole(roles, opts = {}) {
        const names = list(roles)
        for (const name of names) await requireRole(name)
        const { team } = scope(opts)
        await update(subject, ({ roles: current, permissions }) => ({
          roles: [
            ...current.filter((x) => !(names.includes(x.name) && sameScope(x, team))),
            ...names.map((name) => ({ name, team, expiresAt: opts.expiresAt ?? null })),
          ],
          permissions,
        }))
        return api
      },
      async removeRole(roles, opts = {}) {
        const names = list(roles)
        const { team } = scope(opts)
        await update(subject, ({ roles: current, permissions }) => ({
          roles: current.filter((x) => !(names.includes(x.name) && sameScope(x, team))),
          permissions,
        }))
        return api
      },
      async syncRoles(roles, opts = {}) {
        const names = uniq(list(roles))
        for (const name of names) await requireRole(name)
        const { team } = scope(opts)
        await update(subject, ({ roles: current, permissions }) => ({
          roles: [...current.filter((x) => !sameScope(x, team)), ...names.map((name) => ({ name, team, expiresAt: opts.expiresAt ?? null }))],
          permissions,
        }))
        return api
      },
      async givePermission(perms, opts = {}) {
        return setDirect(list(perms), 'allow', opts)
      },
      async deny(perms, opts = {}) {
        return setDirect(list(perms), 'deny', opts)
      },
      async revokePermission(perms, opts = {}) {
        const names = list(perms)
        const { team } = scope(opts)
        await update(subject, ({ roles, permissions }) => ({
          roles,
          permissions: permissions.filter((x) => !(names.includes(x.name) && sameScope(x, team))),
        }))
        return api
      },
      async syncPermissions(perms, opts = {}) {
        const names = uniq(list(perms).map((p) => assertName(p)))
        await checkGrantable(names)
        const { team } = scope(opts)
        await update(subject, ({ roles, permissions }) => ({
          roles,
          permissions: [
            ...permissions.filter((x) => !sameScope(x, team) || x.effect === 'deny'),
            ...names.map((name) => ({ name, effect: 'allow', team, expiresAt: opts.expiresAt ?? null })),
          ],
        }))
        return api
      },
      can: (permission, resource, opts) => {
        ;[resource, opts] = splitArgs(resource, opts)
        return can(subject, permission, resource, scope(opts))
      },
      cannot: async (permission, resource, opts) => !(await api.can(permission, resource, opts)),
      canAny: async (perms, resource, opts) => {
        for (const p of list(perms)) if (await api.can(p, resource, opts)) return true
        return false
      },
      canAll: (perms, resource, opts) => api.can(list(perms), resource, opts),
      hasRole: async (roles, opts) => {
        const have = (await access(subject, scope(opts))).roles
        return list(roles).some((r) => have.includes(r))
      },
      hasAnyRole: (roles, opts) => api.hasRole(roles, opts),
      hasAllRoles: async (roles, opts) => {
        const have = (await access(subject, scope(opts))).roles
        const wanted = list(roles)
        return wanted.length > 0 && wanted.every((r) => have.includes(r))
      },
      roles: async (opts) => (await access(subject, scope(opts))).roles,
      permissions: async (opts) => (await access(subject, scope(opts))).permissions,
      access: (opts) => access(subject, scope(opts)),
      ability: async (opts) => createAbility(await access(subject, scope(opts))),
      // What is stored for this subject, before inheritance and expiry.
      assignments: () => store.getAssignments(ref(subject)),
      authorize: async (permission, resource, opts) => {
        if (!(await api.can(permission, resource, opts))) throw new ForbiddenError(undefined, permission)
      },
    }

    async function setDirect(perms, effect, opts) {
      const names = perms.map((p) => assertName(p))
      await checkGrantable(names)
      const { team } = scope(opts)
      await update(subject, ({ roles, permissions }) => ({
        roles,
        permissions: [
          ...permissions.filter((x) => !(names.includes(x.name) && sameScope(x, team))),
          ...names.map((name) => ({ name, effect, team, expiresAt: opts.expiresAt ?? null })),
        ],
      }))
      return api
    }

    return api
  }

  // ── Declarative sync ───────────────────────────────────────────────
  //
  // await permissions.sync({
  //   permissions: ['posts.view', 'posts.create', { name: 'users.manage', description: '...' }],
  //   roles: {
  //     writer: ['posts.view', 'posts.create'],
  //     editor: { inherits: ['writer'], permissions: ['posts.*'] },
  //     admin: ['*'],
  //   },
  // }, { prune: false })
  //
  // Creates what is missing and updates what changed. With prune: true it
  // also deletes roles and permissions the definition no longer lists.
  async function sync(definition = {}, { prune = false } = {}) {
    const wantedPerms = list(definition.permissions).map((p) => (typeof p === 'string' ? { name: p } : p))
    const cat = await catalog()
    const known = new Map(cat.permissions.map((p) => [p.name, p]))
    for (const p of wantedPerms) {
      const existing = known.get(p.name)
      if (!existing || (p.description !== undefined && p.description !== existing.description)) {
        await createPermission(p.name, { description: p.description ?? existing?.description ?? null })
      }
    }
    const roles = Object.entries(definition.roles ?? {}).map(([name, spec]) =>
      Array.isArray(spec) || typeof spec === 'string' ? { name, permissions: list(spec) } : { name, ...spec },
    )
    // Roles first without parents, so inheritance can point at any of them.
    for (const role of roles) {
      if (!(await findRole(role.name))) await saveRole(role.name, { description: role.description ?? null, permissions: [], inherits: [] }, { create: true })
    }
    for (const role of roles) {
      await saveRole(role.name, { description: role.description, permissions: role.permissions ?? [], inherits: role.inherits ?? [] }, { create: false })
    }
    if (prune) {
      const keepRoles = new Set(roles.map((r) => r.name))
      const keepPerms = new Set(wantedPerms.map((p) => p.name))
      for (const r of (await catalog()).roles) if (!keepRoles.has(r.name)) await store.deleteRole(r.name)
      for (const p of (await catalog()).permissions) if (!keepPerms.has(p.name)) await store.deletePermission(p.name)
      await changed()
    }
    return catalog()
  }

  const permissions = {
    store,

    // Catalog
    createPermission,
    createPermissions: createPermissionsBulk,
    findOrCreatePermission: async (name, opts = {}) => {
      const found = (await catalog()).permissions.find((p) => p.name === name)
      return found ?? createPermission(name, opts)
    },
    deletePermission,
    createRole: (name, opts = {}) => saveRole(name, opts, { create: true }),
    findOrCreateRole: async (name, opts = {}) => (await findRole(name)) ?? saveRole(name, opts, { create: true }),
    updateRole: (name, opts = {}) => saveRole(name, opts, { create: false }),
    deleteRole: async (name) => {
      await store.deleteRole(name)
      await changed()
    },
    findRole,
    roles: async () => (await catalog()).roles,
    listPermissions: async () => (await catalog()).permissions,
    catalog,

    // Role-side grants: permissions.role('editor').give('posts.publish')
    role(name) {
      const api = {
        give: async (perms) => {
          const role = await requireRole(name)
          await saveRole(name, { permissions: [...role.permissions, ...list(perms)] }, { create: false })
          return api
        },
        deny: async (perms) => {
          const role = await requireRole(name)
          await saveRole(name, { permissions: [...role.permissions, ...list(perms).map((p) => `!${p.replace(/^!/, '')}`)] }, { create: false })
          return api
        },
        revoke: async (perms) => {
          const role = await requireRole(name)
          const drop = new Set(list(perms).flatMap((p) => [p, `!${p}`]))
          await saveRole(name, { permissions: role.permissions.filter((p) => !drop.has(p)) }, { create: false })
          return api
        },
        sync: async (perms) => {
          await saveRole(name, { permissions: list(perms) }, { create: false })
          return api
        },
        inherit: async (parents) => {
          const role = await requireRole(name)
          await saveRole(name, { inherits: [...role.inherits, ...list(parents)] }, { create: false })
          return api
        },
        disinherit: async (parents) => {
          const role = await requireRole(name)
          const drop = new Set(list(parents))
          await saveRole(name, { inherits: role.inherits.filter((p) => !drop.has(p)) }, { create: false })
          return api
        },
        get: () => findRole(name),
        // Everything the role allows, inherited included.
        access: async () => {
          const cat = await catalog()
          const names = expandRoles([name], cat.roles)
          const allowed = []
          const denied = []
          for (const n of names) {
            for (const p of cat.roles.find((r) => r.name === n).permissions) (p.startsWith('!') ? denied : allowed).push(p.replace(/^!/, ''))
          }
          return { roles: names.sort(), permissions: uniq(allowed).sort(), denied: uniq(denied).sort(), superAdmin: list(superAdmin).some((s) => names.includes(s)) }
        },
        subjects: () => store.subjectsWithRole(name),
      }
      return api
    },

    // Subject-side: permissions.for(user).assignRole('editor')
    for: subjectApi,
    user: subjectApi,

    // Checks
    access,
    can,
    cannot: async (subject, permission, resource, opts) => !(await can(subject, permission, resource, opts)),
    canAny: async (subject, perms, resource, opts) => {
      for (const p of list(perms)) if (await can(subject, p, resource, opts)) return true
      return false
    },
    canAll: (subject, perms, resource, opts) => can(subject, list(perms), resource, opts),
    hasRole: (subject, roles, opts) => subjectApi(subject).hasRole(roles, opts),
    hasAnyRole: (subject, roles, opts) => subjectApi(subject).hasAnyRole(roles, opts),
    hasAllRoles: (subject, roles, opts) => subjectApi(subject).hasAllRoles(roles, opts),
    authorize: async (subject, permission, resource, opts) => {
      if (!(await can(subject, permission, resource, opts))) throw new ForbiddenError(undefined, permission)
    },
    ability: async (subject, opts) => createAbility(await access(subject, opts)),

    // Who has a role (direct assignments; inherited roles aren't listed).
    subjectsWithRole: (name) => store.subjectsWithRole(name),

    // Resource rules: permissions.rule('posts.update', ({ user, resource, granted }) => ...)
    rule(name, fn) {
      ruleMap.set(name, fn)
      return permissions
    },

    sync,
    // Drops every cached catalog and snapshot (after editing the store
    // directly, for example).
    flush: changed,
    options: { superAdmin, subjectType, ttl, strict, defaultRoles: list(defaultRoles) },
  }

  return permissions
}

export { toAccess }
