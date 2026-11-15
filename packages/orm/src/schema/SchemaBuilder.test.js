import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteAdapter } from '../adapters/SqliteAdapter.js'
import { Blueprint, compileCreateTable, createSchema, changeColumnSql, columnSql, indexName, dropIndexSql } from './SchemaBuilder.js'

function posts(table) {
  table.increments('id')
  table.string('title', 200).notNullable()
  table.string('slug').unique()
  table.enum('status', ['draft', 'published']).default('draft').index()
  table.boolean('featured').default(false)
  table.decimal('price', 10, 2).default(0)
  table.json('meta').default({ a: 1 })
  table.foreignId('user_id').constrained().cascadeOnDelete()
  table.timestamps()
  table.index(['status', 'created_at'])
}

test('compileCreateTable: every SQL dialect', () => {
  const blueprint = new Blueprint('posts')
  posts(blueprint)
  const pg = compileCreateTable('postgres', 'posts', blueprint).join(';\n')
  assert.match(pg, /"id" SERIAL PRIMARY KEY/)
  assert.match(pg, /"title" VARCHAR\(200\) NOT NULL/)
  assert.match(pg, /"status" VARCHAR\(255\) DEFAULT 'draft' CHECK \("status" IN \('draft', 'published'\)\)/)
  assert.match(pg, /"featured" BOOLEAN DEFAULT FALSE/)
  assert.match(pg, /"price" NUMERIC\(10, 2\) DEFAULT 0/)
  assert.match(pg, /"meta" JSONB DEFAULT '\{"a":1\}'/)
  assert.match(pg, /CONSTRAINT "posts_user_id_foreign" FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\) ON DELETE CASCADE/)
  assert.match(pg, /CREATE UNIQUE INDEX IF NOT EXISTS "posts_slug_unique" ON "posts" \("slug"\)/)
  assert.match(pg, /CREATE INDEX IF NOT EXISTS "posts_status_created_at_index" ON "posts" \("status", "created_at"\)/)

  const my = compileCreateTable('mysql', 'posts', blueprint)
  assert.equal(my.length, 1, 'MySQL keeps indexes inside CREATE TABLE')
  assert.match(my[0], /`id` INT AUTO_INCREMENT PRIMARY KEY/)
  assert.match(my[0], /`status` ENUM\('draft', 'published'\) NULL DEFAULT 'draft'/)
  assert.match(my[0], /`meta` JSON NULL DEFAULT \('\{"a":1\}'\)/)
  assert.match(my[0], /UNIQUE KEY `posts_slug_unique` \(`slug`\)/)
  assert.match(compileCreateTable('mariadb', 'posts', blueprint)[0], /`meta` JSON NULL DEFAULT '\{"a":1\}'/)

  assert.match(compileCreateTable('sqlite', 'posts', blueprint)[0], /"id" INTEGER PRIMARY KEY AUTOINCREMENT/)
  assert.match(compileCreateTable('cockroach', 'posts', blueprint)[0], /"id" SERIAL PRIMARY KEY/)
})

test('change, drop index, long names', () => {
  const column = { name: 'title', type: 'string', length: 500, nullable: false, default: 'x' }
  assert.deepEqual(changeColumnSql('postgres', 'posts', column), [
    'ALTER TABLE "posts" ALTER COLUMN "title" TYPE VARCHAR(500) USING "title"::VARCHAR(500)',
    'ALTER TABLE "posts" ALTER COLUMN "title" SET NOT NULL',
    `ALTER TABLE "posts" ALTER COLUMN "title" SET DEFAULT 'x'`,
  ])
  assert.deepEqual(changeColumnSql('mysql', 'posts', column), ["ALTER TABLE `posts` MODIFY COLUMN `title` VARCHAR(500) NOT NULL DEFAULT 'x'"])
  assert.equal(dropIndexSql('cockroach', 'posts', 'posts_slug_unique', { unique: true }), 'DROP INDEX IF EXISTS "posts"@"posts_slug_unique" CASCADE')
  assert.equal(dropIndexSql('mysql', 'posts', 'i'), 'ALTER TABLE `posts` DROP INDEX `i`')
  const long = indexName('a_really_long_table_name_for_testing', ['first_column', 'second_column', 'third_column'], 'index')
  assert.ok(long.length <= 60)
  assert.equal(long, indexName('a_really_long_table_name_for_testing', ['first_column', 'second_column', 'third_column'], 'index'))
  assert.equal(columnSql('mysql', { name: 'n', type: 'integer', unsigned: true, nullable: false, after: 'id' }), '`n` INT UNSIGNED NOT NULL AFTER `id`')
})

async function sqlite() {
  const adapter = await new SqliteAdapter({ filename: ':memory:' }).connect()
  return { adapter, schema: createSchema(adapter) }
}

test('SQLite: create with indexes and foreign keys, then alter every way', async () => {
  const { adapter, schema } = await sqlite()
  await schema.createTable('users', (t) => {
    t.increments()
    t.string('email').notNullable().unique()
  })
  await schema.createTable('posts', posts)
  assert.ok(await schema.hasTable('posts'))
  assert.deepEqual((await schema.getIndexes('posts')).sort(), ['posts_slug_unique', 'posts_status_created_at_index', 'posts_status_index'])

  await adapter.run("INSERT INTO users (email) VALUES ('a@b.c')")
  await adapter.run("INSERT INTO posts (title, slug, user_id, created_at) VALUES ('Hello', 'hello', 1, 'now')")

  await schema.alterTable('posts', (t) => {
    t.string('subtitle').unique() // was impossible before: SQLite refuses ADD COLUMN ... UNIQUE
    t.integer('views').notNullable().default(0)
    t.renameColumn('title', 'heading')
  })
  // A change and a drop rebuild the table; rows, indexes and keys survive.
  await schema.alterTable('posts', (t) => {
    t.text('heading').nullable().change()
    t.dropColumn('price')
    t.dropIndex(['status'])
  })
  const columns = await schema.getColumns('posts')
  assert.ok(columns.includes('heading') && columns.includes('views') && !columns.includes('price') && !columns.includes('title'))
  const row = await adapter.get('SELECT * FROM posts')
  assert.equal(row.heading, 'Hello')
  assert.equal(row.views, 0)
  const indexes = await schema.getIndexes('posts')
  assert.ok(indexes.includes('posts_slug_unique') && indexes.includes('posts_subtitle_unique') && !indexes.includes('posts_status_index'))
  const fks = await adapter.all('PRAGMA foreign_key_list(posts)')
  assert.equal(fks[0]?.table, 'users')
  assert.equal(fks[0]?.on_delete, 'CASCADE')
  await assert.rejects(adapter.run("INSERT INTO posts (heading, slug) VALUES ('x', 'hello')"), /UNIQUE/)

  // Drop the foreign key, then the indexed column it was on.
  await schema.alterTable('posts', (t) => t.dropForeign(['user_id']))
  assert.equal((await adapter.all('PRAGMA foreign_key_list(posts)')).length, 0)
  await schema.alterTable('posts', (t) => t.dropColumn('slug'))
  assert.ok(!(await schema.hasColumn('posts', 'slug')))

  await schema.renameTable('posts', 'articles')
  assert.ok(await schema.hasTable('articles'))
  await schema.dropIfExists('articles')
  assert.ok(!(await schema.hasTable('articles')))
  await adapter.close()
})

test('SQLite: a failed migration inside transaction() leaves nothing behind', async () => {
  const { adapter, schema } = await sqlite()
  await assert.rejects(
    adapter.transaction(async () => {
      await schema.createTable('half', (t) => t.increments())
      await schema.alterTable('missing', (t) => t.string('x'))
    }),
  )
  assert.equal(await schema.hasTable('half'), false)
  await adapter.close()
})
