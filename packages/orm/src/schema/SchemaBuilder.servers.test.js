// The schema builder against real servers. Skipped unless
// TYLIX_TEST_DATABASES names them, e.g.
//   TYLIX_TEST_DATABASES='postgres://postgres:secret@127.0.0.1:15432/postgres,mysql://root:secret@127.0.0.1:13307/mysql'
// Schemes: postgres, cockroach, mysql, mariadb, mongodb. A fresh database
// "tylix_schema_test" is created on each.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAdapter } from '../adapters/AdapterFactory.js'
import { ensureDatabaseExists } from '../ensureDatabaseExists.js'
import { createSchema } from './SchemaBuilder.js'

const DB = 'tylix_schema_test'
const targets = (process.env.TYLIX_TEST_DATABASES ?? '').split(',').filter(Boolean)

function configFor(raw) {
  const url = new URL(raw)
  const driver = url.protocol.replace(':', '').replace('postgresql', 'postgres')
  if (driver === 'mongodb') return { driver, url: `mongodb://${url.host}`, database: DB }
  return { driver, host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: DB }
}

async function fresh(config) {
  await ensureDatabaseExists(config)
  const adapter = await createAdapter(config).connect()
  const schema = createSchema(adapter)
  if (adapter.dialect === 'mongodb') await adapter.db.dropDatabase()
  else {
    const mysql = adapter.dialect === 'mysql' || adapter.dialect === 'mariadb'
    if (mysql) await adapter.run('SET FOREIGN_KEY_CHECKS = 0')
    for (const t of await adapter.listTables()) await schema.dropTable(t)
    if (mysql) await adapter.run('SET FOREIGN_KEY_CHECKS = 1')
  }
  return { adapter, schema }
}

for (const raw of targets) {
  const config = configFor(raw)
  test(`${config.driver}: create, alter, indexes, foreign keys, rename, drop`, async () => {
    const { adapter, schema } = await fresh(config)
    try {
      const mongo = adapter.dialect === 'mongodb'
      await schema.createTable('users', (t) => {
        t.increments()
        t.string('email').notNullable().unique()
      })
      await schema.createTable('posts', (t) => {
        t.increments()
        t.string('title', 200).notNullable()
        t.string('slug').unique()
        t.enum('status', ['draft', 'published']).default('draft').index()
        t.boolean('featured').default(false)
        t.decimal('price', 10, 2).default(0)
        t.json('meta')
        t.foreignId('user_id').constrained().cascadeOnDelete()
        t.timestamps()
        t.index(['status', 'created_at'])
      })
      assert.ok(await schema.hasTable('posts'))
      const indexes = await schema.getIndexes('posts')
      for (const name of ['posts_slug_unique', 'posts_status_index', 'posts_status_created_at_index']) assert.ok(indexes.includes(name), `${name} in ${indexes}`)
      if (mongo) return

      const user = await adapter.run("INSERT INTO users (email) VALUES ('a@b.c')")
      const userId = user.lastInsertRowid
      assert.equal(typeof userId, 'number', 'ids are JavaScript numbers')
      assert.ok(userId < 1000, `small sequential ids, got ${userId}`)
      await adapter.run("INSERT INTO posts (title, slug, user_id) VALUES ('Hello', 'hello', ?)", [userId])
      const inserted = await adapter.get('SELECT * FROM posts')
      assert.equal(inserted.status, 'draft')
      assert.equal(Boolean(inserted.featured), false)

      await schema.alterTable('posts', (t) => {
        t.string('subtitle').unique()
        t.integer('views').notNullable().default(0)
        t.renameColumn('title', 'heading')
      })
      await schema.alterTable('posts', (t) => {
        t.text('heading').nullable().change()
        t.dropIndex(['status'])
        t.dropIndex(['status', 'created_at'])
      })
      await schema.alterTable('posts', (t) => t.dropColumn('price'))
      const columns = await schema.getColumns('posts')
      assert.ok(columns.includes('heading') && columns.includes('views') && !columns.includes('price'), String(columns))
      const row = await adapter.get('SELECT * FROM posts')
      assert.equal(row.heading, 'Hello')
      assert.equal(Number(row.views), 0)
      assert.ok(!(await schema.getIndexes('posts')).includes('posts_status_index'))
      await assert.rejects(adapter.run("INSERT INTO posts (heading, slug) VALUES ('x', 'hello')"))
      // The foreign key holds, then goes away.
      await assert.rejects(adapter.run("INSERT INTO posts (heading, slug, user_id) VALUES ('x', 'other', 9999)"))
      await schema.alterTable('posts', (t) => t.dropForeign(['user_id']))
      await adapter.run("INSERT INTO posts (heading, slug, user_id) VALUES ('x', 'other', 9999)")
      // A foreign key added to an existing column.
      await adapter.run('DELETE FROM posts WHERE user_id = 9999')
      await schema.alterTable('posts', (t) => t.foreign('user_id').references('id').on('users').nullOnDelete())
      await assert.rejects(adapter.run("INSERT INTO posts (heading, slug, user_id) VALUES ('x', 'third', 9999)"))
      await schema.alterTable('posts', (t) => t.dropUnique(['slug']))
      await adapter.run("INSERT INTO posts (heading, slug, user_id) VALUES ('x', 'hello', ?)", [userId])

      await schema.renameTable('posts', 'articles')
      assert.ok(await schema.hasTable('articles'))
      await schema.dropIfExists('articles')
      assert.ok(!(await schema.hasTable('articles')))
    } finally {
      await adapter.close()
    }
  })
}

if (targets.length === 0) test('database servers (set TYLIX_TEST_DATABASES to run)', { skip: true }, () => {})
