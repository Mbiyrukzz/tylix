import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPermissions, memoryStore, ormStore, matches, PermissionError, ForbiddenError, PERMISSION_MARK } from '../src/index.js'
import { can, hasRole, createAbility, check } from '../src/client.js'
import { createPermissionTables, dropPermissionTables } from '../src/schema.js'

describe('matching', () => {
  const cases = [
    ['posts.edit', 'posts.edit', true],
    ['posts.edit', 'posts.delete', false],
    ['*', 'anything.at.all', true],
    ['posts.*', 'posts.edit', true],
    ['posts.*', 'posts.edit.own', true],
    ['posts.*', 'posts', false],
    ['posts.*', 'comments.edit', false],
    ['posts.*.own', 'posts.edit.own', true],
    ['posts.*.own', 'posts.edit.any', false],
    ['posts.*.own', 'posts.edit', false],
    ['posts.edit,delete', 'posts.delete', true],
    ['posts.edit,delete', 'posts.view', false],
    ['posts.edit', 'posts.*', false],
    ['posts.*', 'posts.*', true],
    ['Posts.edit', 'posts.edit', false],
  ]
  for (const [grant, requested, expected] of cases) {
    test(`${grant} ${expected ? 'covers' : 'does not cover'} ${requested}`, () => {
      assert.equal(matches(grant, requested), expected)
    })
  }
})

async function setup(options = {}) {
  const permissions = createPermissions({ superAdmin: 'super-admin', ...options })
  await permissions.sync({
    permissions: ['posts.view', 'posts.create', 'posts.edit', 'posts.delete', 'posts.publish', 'users.manage', 'billing.view'],
    roles: {
      writer: ['posts.view', 'posts.create'],
      editor: { inherits: ['writer'], permissions: ['posts.*', '!posts.delete'], description: 'Edits everyone’s posts' },
      admin: { inherits: ['editor'], permissions: ['users.manage'] },
      'super-admin': [],
    },
  })
  return permissions
}

describe('engine', () => {
  test('roles grant permissions, and inherited roles count', async () => {
    const p = await setup()
    const ann = { id: 1 }
    await p.for(ann).assignRole('editor')
    assert.equal(await p.can(ann, 'posts.view'), true) // from writer
    assert.equal(await p.can(ann, 'posts.publish'), true) // posts.*
    assert.equal(await p.can(ann, 'users.manage'), false)
    assert.deepEqual(await p.for(ann).roles(), ['editor', 'writer'])
    assert.equal(await p.hasRole(ann, 'writer'), true)
    assert.equal(await p.hasAllRoles(ann, ['editor', 'writer']), true)
    assert.equal(await p.hasAllRoles(ann, ['editor', 'admin']), false)
  })

  test('a deny beats any allow, from a role or directly', async () => {
    const p = await setup()
    const ann = { id: 1 }
    await p.for(ann).assignRole('editor')
    assert.equal(await p.can(ann, 'posts.delete'), false) // !posts.delete in editor
    await p.for(ann).givePermission('posts.delete')
    assert.equal(await p.can(ann, 'posts.delete'), false) // still denied by the role
    const bob = { id: 2 }
    await p.for(bob).assignRole('writer')
    await p.for(bob).deny('posts.create')
    assert.equal(await p.can(bob, 'posts.create'), false)
    assert.equal(await p.can(bob, 'posts.view'), true)
  })

  test('the super admin passes every check, denies included', async () => {
    const p = await setup()
    await p.for(9).assignRole('super-admin')
    assert.equal(await p.can(9, 'posts.delete'), true)
    assert.equal(await p.can(9, 'not.even.defined'), true)
    assert.equal((await p.access(9)).superAdmin, true)
  })

  test('direct permissions, revoke and sync', async () => {
    const p = await setup()
    const u = { userId: 5 } // a Tylix req.user
    await p.for(u).givePermission(['billing.view', 'posts.view'])
    assert.equal(await p.canAll(u, ['billing.view', 'posts.view']), true)
    await p.for(u).revokePermission('billing.view')
    assert.equal(await p.can(u, 'billing.view'), false)
    await p.for(u).syncPermissions(['users.manage'])
    assert.deepEqual(await p.for(u).permissions(), ['users.manage'])
    // ids are compared as strings
    assert.equal(await p.can('5', 'users.manage'), true)
  })

  test('teams scope assignments; global ones apply everywhere', async () => {
    const p = await setup()
    const ann = { id: 1 }
    await p.for(ann).assignRole('writer')
    await p.for(ann).assignRole('admin', { team: 'acme' })
    assert.equal(await p.can(ann, 'users.manage'), false)
    assert.equal(await p.can(ann, 'users.manage', { team: 'acme' }), true)
    assert.equal(await p.can(ann, 'users.manage', { team: 'globex' }), false)
    assert.equal(await p.can(ann, 'posts.view', { team: 'globex' }), true)
    const scoped = p.for(ann, { team: 'acme' })
    assert.equal(await scoped.can('users.manage'), true)
    assert.equal(await scoped.hasRole('admin'), true)
    await scoped.removeRole('admin')
    assert.equal(await p.can(ann, 'users.manage', { team: 'acme' }), false)
    assert.equal(await p.hasRole(ann, 'writer'), true)
  })

  test('assignments expire', async () => {
    const p = await setup()
    await p.for(1).assignRole('admin', { expiresAt: new Date(Date.now() - 1000) })
    assert.equal(await p.can(1, 'users.manage'), false)
    await p.for(2).assignRole('admin', { expiresAt: new Date(Date.now() + 60_000) })
    assert.equal(await p.can(2, 'users.manage'), true)
    await p.for(3).assignRole('admin', { expiresAt: new Date(Date.now() + 80) })
    assert.equal(await p.can(3, 'users.manage'), true)
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(await p.can(3, 'users.manage'), false) // not served from cache past its expiry
  })

  test('rules decide resource checks', async () => {
    const p = await setup({
      rules: {
        'posts.edit': ({ user, resource, granted, can }) =>
          granted || (resource.authorId === user.id && can('posts.create')),
      },
    })
    const writer = { id: 3 }
    await p.for(writer).assignRole('writer')
    assert.equal(await p.can(writer, 'posts.edit', { authorId: 3 }), true)
    assert.equal(await p.can(writer, 'posts.edit', { authorId: 4 }), false)
    assert.equal(await p.can(writer, 'posts.edit'), false) // no resource: stored permissions only
    await assert.rejects(p.authorize(writer, 'posts.edit', { authorId: 4 }), ForbiddenError)
    await p.authorize(writer, 'posts.edit', { authorId: 3 })
  })

  test('typos fail loudly; patterns need no row', async () => {
    const p = await setup()
    await assert.rejects(p.for(1).assignRole('edtor'), (e) => e instanceof PermissionError && e.code === 'ROLE_DOES_NOT_EXIST')
    await assert.rejects(p.for(1).givePermission('posts.edti'), (e) => e.code === 'PERMISSION_DOES_NOT_EXIST')
    await assert.rejects(p.createRole('writer'), (e) => e.code === 'ROLE_ALREADY_EXISTS')
    await assert.rejects(p.createPermission('bad name'), TypeError)
    await p.for(1).givePermission('billing.*')
    assert.equal(await p.can(1, 'billing.view'), true)
  })

  test('inheritance cycles are refused', async () => {
    const p = await setup()
    await assert.rejects(p.role('writer').inherit('admin'), (e) => e.code === 'ROLE_CYCLE')
    await assert.rejects(p.role('writer').inherit('writer'), (e) => e.code === 'ROLE_CYCLE')
  })

  test('role-side changes reach users at once', async () => {
    const p = await setup()
    await p.for(1).assignRole('writer')
    assert.equal(await p.can(1, 'billing.view'), false)
    await p.role('writer').give('billing.view')
    assert.equal(await p.can(1, 'billing.view'), true)
    await p.role('writer').revoke('billing.view')
    assert.equal(await p.can(1, 'billing.view'), false)
    await p.deleteRole('writer')
    assert.deepEqual(await p.for(1).roles(), [])
    assert.deepEqual((await p.findRole('editor')).inherits, [])
  })

  test('deleting a permission removes it from roles and users', async () => {
    const p = await setup()
    await p.for(1).givePermission('billing.view')
    await p.role('writer').give('billing.view')
    await p.deletePermission('billing.view')
    assert.equal((await p.findRole('writer')).permissions.includes('billing.view'), false)
    assert.deepEqual((await p.for(1).assignments()).permissions, [])
  })

  test('sync is idempotent and can prune', async () => {
    const p = await setup()
    const before = await p.catalog()
    const again = await p.sync({ permissions: ['posts.view'], roles: { writer: ['posts.view', 'posts.create'] } })
    assert.equal(again.roles.length, before.roles.length)
    const pruned = await p.sync({ permissions: ['posts.view'], roles: { reader: ['posts.view'] } }, { prune: true })
    assert.deepEqual(pruned.roles.map((r) => r.name), ['reader'])
    assert.deepEqual(pruned.permissions.map((x) => x.name), ['posts.view'])
  })

  test('subjects of other types', async () => {
    const p = await setup()
    const client = { type: 'api-client', id: 'ci-bot' }
    await p.for(client).assignRole('writer')
    assert.equal(await p.can(client, 'posts.create'), true)
    assert.equal(await p.can({ id: 'ci-bot' }, 'posts.create'), false) // a user with the same id
    assert.deepEqual(await p.role('writer').subjects(), [{ type: 'api-client', id: 'ci-bot', team: null, expiresAt: null }])
  })

  test('guests and empty requests', async () => {
    const p = await setup()
    assert.equal(await p.can(null, 'posts.view'), false)
    assert.equal(await p.can(1, []), false)
    assert.deepEqual(await p.access(undefined), { roles: [], permissions: [], denied: [], superAdmin: false })
  })
})

describe('client snapshot', () => {
  test('answers the same as the server', async () => {
    const p = await setup()
    await p.for(1).assignRole('editor')
    const access = await p.access(1)
    const user = { id: 1, name: 'Ann', access: JSON.parse(JSON.stringify(access)) }
    for (const perm of ['posts.view', 'posts.publish', 'posts.delete', 'users.manage', 'billing.view']) {
      assert.equal(can(user, perm), await p.can(1, perm), perm)
    }
    assert.equal(hasRole(user, 'writer'), true)
    assert.equal(can(null, 'posts.view'), false)
    const ability = createAbility(user)
    assert.deepEqual(ability.allowed(['posts.edit', 'posts.delete', 'users.manage']), ['posts.edit'])
    assert.equal(check(user, 'role:admin|editor'), true)
    assert.equal(check(user, 'any:users.manage|posts.edit'), true)
    assert.equal(check(user, 'all:users.manage|posts.edit'), false)
  })
})

describe('http', () => {
  const run = async (mw, req) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    let called = false
    await mw(req, res, async () => {
      called = true
    })
    return { res, called }
  }

  test('middleware answers 401, 403 or calls next', async () => {
    const p = await setup()
    await p.for(1).assignRole('writer')
    const mw = p.middleware('posts.create')
    assert.equal(mw[PERMISSION_MARK], 'posts.create')
    assert.equal((await run(mw, {})).res.statusCode, 401)
    assert.equal((await run(mw, { user: { userId: 1 } })).called, true)
    const denied = await run(p.middleware('users.manage'), { user: { userId: 1 } })
    assert.equal(denied.res.statusCode, 403)
    assert.equal(denied.res.body.required, 'users.manage')
    assert.equal((await run(p.middleware({ role: ['admin', 'writer'] }), { user: { userId: 1 } })).called, true)
    assert.equal((await run(p.middleware({ any: ['users.manage', 'posts.view'] }), { user: { userId: 1 } })).called, true)
  })

  test('guardRequest returns a Response only when refused', async () => {
    const p = await setup()
    await p.for(1).assignRole('writer')
    assert.equal(await p.guardRequest({ id: 1 }, 'posts.view'), null)
    const res = await p.guardRequest({ id: 1 }, 'users.manage')
    assert.equal(res.status, 403)
    assert.equal((await p.guardRequest(null, 'posts.view')).status, 401)
  })
})

describe('shared cache', () => {
  test('a change in one process is seen by another at once', async () => {
    const shared = new Map()
    const cache = {
      async get(k) {
        return shared.get(k)
      },
      async set(k, v) {
        shared.set(k, v)
      },
      async forget(k) {
        shared.delete(k)
      },
    }
    const store = memoryStore()
    const a = createPermissions({ store, cache })
    const b = createPermissions({ store, cache })
    await a.sync({ permissions: ['x.y'], roles: { r: ['x.y'] } })
    await a.for(1).assignRole('r')
    assert.equal(await b.can(1, 'x.y'), true)
    await a.role('r').revoke('x.y')
    assert.equal(await b.can(1, 'x.y'), false)
  })
})

describe('orm store (SQLite)', () => {
  test('stores the catalog and assignments in the database', async () => {
    const { SqliteAdapter, ConnectionManager, Model, createSchema } = await import('@tylix/orm')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-permissions-'))
    const adapter = new SqliteAdapter({ filename: path.join(dir, 'db.sqlite') })
    await adapter.connect()
    ConnectionManager.setAdapter(adapter)
    try {
      const schema = createSchema(adapter)
      await createPermissionTables(schema)
      const p = await setup({ store: ormStore({ Model }) })
      await p.for({ id: 7 }).assignRole('editor', { team: 'acme' })
      await p.for({ id: 7 }).deny('posts.view', { team: 'acme' })

      // A fresh instance reads it all back from the database.
      const fresh = createPermissions({ store: ormStore({ Model }), superAdmin: 'super-admin' })
      assert.equal(await fresh.can(7, 'posts.publish', { team: 'acme' }), true)
      assert.equal(await fresh.can(7, 'posts.view', { team: 'acme' }), false)
      assert.equal(await fresh.can(7, 'posts.publish'), false)
      assert.deepEqual((await fresh.findRole('editor')).inherits, ['writer'])
      assert.equal((await fresh.findRole('editor')).description, 'Edits everyone’s posts')

      await fresh.deleteRole('writer')
      assert.deepEqual((await fresh.findRole('editor')).inherits, [])
      await fresh.deletePermission('posts.view')
      assert.deepEqual((await fresh.for(7).assignments()).permissions, [])

      await dropPermissionTables(schema)
    } finally {
      await adapter.close()
      ConnectionManager.reset()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('native runtime parity', () => {
  test('.tyx pages match permissions exactly like the package', async () => {
    const source = await fs.readFile(new URL('../../compiler/src/runtime/permissions.js', import.meta.url), 'utf-8')
    const runtimeMatches = new Function(`${source}\nreturn __tylixPermissionMatches`)()
    const grants = ['*', 'posts', 'posts.*', 'posts.edit', 'posts.*.own', 'posts.edit,delete', 'posts.edit, delete', 'a.*.c.*', 'Posts.edit']
    const requested = ['posts', 'posts.edit', 'posts.delete', 'posts.edit.own', 'posts.view.any', 'a.b.c.d', 'a.b.c', 'posts.*', 'x', '']
    for (const g of grants) {
      for (const r of requested) assert.equal(runtimeMatches(g, r), matches(g, r), `${g} vs ${r}`)
    }
  })
})

describe('default roles', () => {
  test('every signed-in subject has them; guests do not', async () => {
    const p = await setup({ defaultRoles: ['writer'] })
    assert.equal(await p.can(42, 'posts.create'), true)
    assert.deepEqual(await p.for(42).roles(), ['writer'])
    assert.equal(await p.can(null, 'posts.create'), false)
    await p.for(42).deny('posts.create')
    assert.equal(await p.can(42, 'posts.create'), false)
  })
})
