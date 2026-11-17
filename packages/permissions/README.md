# @tylix/permissions

Roles and permissions for **any JavaScript app**: Express, Fastify, Hono,
Next.js, Nuxt, SvelteKit, Remix, Astro and Tylix on the server; React,
Vue, Svelte, Angular and Tylix pages in the browser. No dependencies.

It is inspired by Laravel's spatie/laravel-permission, and adds what you
otherwise build yourself:

| | spatie/laravel-permission | @tylix/permissions |
| --- | --- | --- |
| Roles, permissions, direct grants | ✔ | ✔ |
| Wildcards (`posts.*`, `posts.edit,delete`, `*`) | opt-in | built in |
| Role inheritance (`editor` inherits `writer`) | | ✔ |
| Explicit denies that beat any allow | | ✔ (`!posts.delete`, `deny()`) |
| Teams / tenants | ✔ | ✔, per assignment |
| Grants that expire | | ✔ |
| Default roles every signed-in user has | | ✔ |
| Resource rules (`can(user, 'posts.update', post)`) | via policies | ✔ |
| Same answer in the browser, synchronously | | ✔ (`user.access`) |
| Declarative, idempotent `sync()` for seeders | | ✔ |
| Storage | Eloquent | memory, Tylix ORM, or your own store |

```sh
npm install @tylix/permissions
```

## Quick start

```js
import { createPermissions } from '@tylix/permissions'

const permissions = createPermissions({ superAdmin: 'super-admin' })

await permissions.sync({
  permissions: ['posts.view', 'posts.create', 'posts.update', 'posts.delete', 'users.manage'],
  roles: {
    writer: ['posts.view', 'posts.create'],
    editor: { inherits: ['writer'], permissions: ['posts.*', '!posts.delete'] },
    admin: { inherits: ['editor'], permissions: ['users.*'] },
    'super-admin': [],
  },
})

await permissions.for(user).assignRole('editor')

await permissions.can(user, 'posts.update')  // true (posts.*)
await permissions.can(user, 'posts.delete')  // false (denied by the role)
await permissions.hasRole(user, 'writer')    // true (inherited)
```

A subject is a user row (`{ id }`), a Tylix `req.user` (`{ userId }`), a
plain id, or `{ type, id }` for things that aren't users (API clients,
devices). Ids are compared as strings.

## Names and wildcards

Permission names are dot-separated words: `posts.edit`,
`billing.invoices.export`. Grants can use:

| Grant | Covers |
| --- | --- |
| `*` | everything |
| `posts.*` | `posts.edit`, `posts.edit.own`, ... (one or more segments) |
| `posts.*.own` | `posts.edit.own` (exactly one segment in the middle) |
| `posts.edit,delete` | `posts.edit` and `posts.delete` |
| `!posts.delete` | in a role: a deny |

A deny always wins over an allow, from any role or direct grant. Only the
super-admin role passes everything, denies included.

Concrete names must be created before they are granted, so a typo fails
loudly (`PermissionError` with `code: 'PERMISSION_DOES_NOT_EXIST'`).
Patterns never need a row. Pass `strict: false` to turn this off.

## Roles

```js
await permissions.createRole('support', { permissions: ['users.view'], inherits: ['writer'], description: 'Helps customers' })
await permissions.updateRole('support', { permissions: ['users.view', 'tickets.*'] })
await permissions.role('support').give('billing.view')
await permissions.role('support').deny('users.delete')
await permissions.role('support').revoke('billing.view')
await permissions.role('support').inherit('writer')
await permissions.role('support').access()     // everything it allows, inherited included
await permissions.role('support').subjects()   // who has it
await permissions.deleteRole('support')        // also removes it from users and inheritors
await permissions.roles()                      // the catalog
```

Inheritance cycles are refused (`code: 'ROLE_CYCLE'`).

## Users (subjects)

```js
const u = permissions.for(user)
await u.assignRole('editor')
await u.assignRole('admin', { team: 'acme' })                  // only in team acme
await u.assignRole('support', { expiresAt: '2027-01-01' })     // until then
await u.removeRole('editor')
await u.syncRoles(['writer'])
await u.givePermission('billing.view')
await u.deny('posts.publish')                                  // beats every role
await u.revokePermission('billing.view')
await u.syncPermissions(['billing.view'])                       // keeps denies

await u.can('posts.publish')
await u.canAny(['posts.update', 'posts.publish'])
await u.canAll(['posts.update', 'posts.publish'])
await u.hasRole(['admin', 'editor'])                            // any of them
await u.hasAllRoles(['admin', 'editor'])
await u.roles()                                                 // inherited included
await u.access()                                                // the snapshot (below)
await u.authorize('posts.publish')                              // throws ForbiddenError (status 403)
```

Every check takes `{ team }`. Assignments without a team apply in every
team; team assignments only in theirs. `permissions.for(user, { team: 'acme' })`
binds a team for a series of calls.

`defaultRoles: ['member']` gives every signed-in subject a role without
assigning it (guests get nothing), which is handy for "what any account may
do".

## Resource rules

Stored permissions answer "may they edit posts?". A rule answers "may they
edit *this* post?":

```js
const permissions = createPermissions({
  rules: {
    'posts.update': ({ user, resource, granted, can }) =>
      granted || resource.authorId === user.id,
  },
})

await permissions.can(user, 'posts.update', post)
```

The rule gets `granted` (what stored permissions say), the `access`
snapshot, the `team`, and `can(other)` for further checks. Without a
resource, only stored permissions count. Rules can be async, and can also
be added later with `permissions.rule(name, fn)`.

## The browser

The server computes an **access snapshot** once and sends it with the user:

```js
user.access = await permissions.access(user)
// { roles: ['editor', 'writer'], permissions: ['posts.*', ...], denied: ['posts.delete'], superAdmin: false }
```

Then any code checks synchronously, with the same matching as the server:

```js
import { can, hasRole, createAbility } from '@tylix/permissions/client'

can(user, 'posts.update')          // reads user.access
hasRole(user, ['admin', 'editor'])
createAbility(user).allowed(['posts.create', 'users.manage'])
```

Hiding a button is not security: guard the route that does the work too.

### React

```jsx
import { PermissionsProvider, Can, useCan } from '@tylix/permissions/react'

<PermissionsProvider user={useAuth().user}>
  <Can permission="posts.create"><NewPostButton /></Can>
  <Can role="admin" fallback={<p>Admins only.</p>}><AdminPanel /></Can>
  <Can any={['posts.update', 'posts.publish']}>...</Can>
</PermissionsProvider>

const canPublish = useCan('posts.publish')   // also 'role:admin', 'any:a|b', ['a', 'b']
```

### Vue

```js
import { permissionsPlugin, useCan } from '@tylix/permissions/vue'
app.use(permissionsPlugin(() => useAuth().user.value))
```

```vue
<button v-can="'posts.create'">New post</button>
<AdminPanel v-if="$can('role:admin')" />
<script setup>const canPublish = useCan('posts.publish')</script>
```

### Svelte

```svelte
<script>
  import { auth } from '@tylix/svelte'
  import { abilityStore, can } from '@tylix/permissions/svelte'
  const ability = abilityStore(auth.user)
</script>

{#if $ability.can('posts.create')}<NewPostButton />{/if}
<button use:can={['posts.delete', $ability]}>Delete</button>
```

### Angular

```ts
// app.config.ts
providers: [providePermissions(() => injectAuth().user)]

// a component
can = injectCan()
// @if (can('posts.create')) { <app-new-post /> }

// routes
{ path: 'admin', canActivate: [permissionGuard('role:admin')], loadComponent: ... }
```

## HTTP

```js
// Tylix routes, Express, Connect, Polka (req.user by default)
router.post('/api/posts', permissions.middleware('posts.create'), handler)
router.delete('/api/posts/:id', permissions.middleware({ any: ['posts.delete', 'posts.moderate'] }), handler)
router.get('/admin', permissions.middleware({ role: 'admin' }), handler)

// Wrap a handler, like requireAuth
router.put('/api/posts/:id', permissions.guard(handler, 'posts.update', {
  resource: (req) => Post.find(req.params.id),      // runs the posts.update rule
}))

// Hono, Next.js route handlers, SvelteKit, Workers: null when allowed
const denied = await permissions.guardRequest(user, 'posts.create')
if (denied) return denied
```

It answers `401` without a user and `403 { error, required }` when the
check fails. Options: `user(req)`, `team(req)`, `resource(req)`,
`message`, `onDenied(req, res)`.

## Storage

```js
import { memoryStore, ormStore } from '@tylix/permissions'
import { Model } from '@tylix/orm'

createPermissions({ store: memoryStore() })          // the default
createPermissions({ store: ormStore({ Model }) })    // the Tylix ORM: SQLite, PostgreSQL, MySQL, MariaDB, CockroachDB
```

The ORM store uses six tables. Create them in a migration:

```js
import { createPermissionTables, dropPermissionTables } from '@tylix/permissions/schema'
export const up = (schema) => createPermissionTables(schema)
export const down = (schema) => dropPermissionTables(schema)
```

Any other database works through a store: an object with `loadCatalog`,
`savePermission`, `deletePermission`, `saveRole`, `deleteRole`,
`getAssignments`, `setAssignments` and `subjectsWithRole`. See
`src/stores/memory.js` for the contract; it is about 80 lines.

## Caching

Catalogs and snapshots are cached for `ttl` seconds (default 30) and
dropped on every change made through the instance. With several
processes, pass a shared `cache` (Tylix's `cache`, or any
`get/set(key, value, ttlSeconds)/forget` wrapper over Redis) and every
process sees a change on its next check. `permissions.flush()` drops
everything after editing the store directly.

## In a Tylix app

```sh
tylix make:permissions
npm install && tylix migrate && tylix db:seed
tylix permission:assign admin you@example.com
```

That writes `app/permissions` (the instance, its rules and the starting
roles), `Role` and `Permission` models, the migration, a seeder, an admin
API, and, for `.tyx` apps, an admin page at `/admin/access` with modals to
create roles and permissions and to give users roles. Changes that would
remove your own access to that page are refused.

Then:

- `GET /api/me` (and the server-rendered session) carries `user.access`.
- `.tyx` pages check with `can("posts.create")`, `cannot(...)`,
  `canAny([...])` and `hasRole("admin")` in templates, and a page's
  `permissions` block is enforced: guests go to login, others see a 403.
- `tylix dev` marks guarded routes with 🔑 and the permission they need.

From the terminal:

| Command | |
| --- | --- |
| `tylix permission:create-role support users.view tickets.* --inherits writer` | a role |
| `tylix permission:create-permission invoices.export --description "..."` | permissions |
| `tylix permission:assign admin ada@example.com [--team acme] [--expires 2027-01-01]` | give a role |
| `tylix permission:revoke admin ada@example.com` | take it back |
| `tylix permission:show [user]` | the role × permission matrix, or one user's access |
| `tylix permission:sync` | apply the definition in `app/permissions` |

## License

MIT
