import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alterMigrationSource, inferMigration } from './makeMigration.js'
import { parseFieldArg, columnModifiers } from '@tylix/shared'

test('inferMigration reads the name like Laravel', () => {
  assert.deepEqual(inferMigration('posts'), { kind: 'create', table: 'posts', legacy: true })
  assert.deepEqual(inferMigration('create_blog_posts_table'), { kind: 'create', table: 'blog_posts' })
  assert.deepEqual(inferMigration('add_status_to_posts_table'), { kind: 'add', table: 'posts' })
  assert.deepEqual(inferMigration('add_status_and_views_to_blog_posts'), { kind: 'add', table: 'blog_posts' })
  assert.deepEqual(inferMigration('remove_legacy_from_posts_table'), { kind: 'remove', table: 'posts' })
  assert.deepEqual(inferMigration('index_slug_on_posts'), { kind: 'alter', table: 'posts' })
  assert.deepEqual(inferMigration('tune', { table: 'posts' }), { kind: 'alter', table: 'posts' })
  assert.deepEqual(inferMigration('whatever', { create: 'roles' }), { kind: 'create', table: 'roles' })
  assert.equal(inferMigration('do_stuff').table, null)
})

test('field arguments carry modifiers into the migration', () => {
  const f = parseFieldArg('status:string:index:required:default=draft')
  assert.deepEqual(f, { name: 'status', type: 'string', index: true, nullable: false, default: 'draft' })
  assert.equal(columnModifiers(f), '.notNullable().default("draft").index()')
  assert.deepEqual(parseFieldArg('views:integer:default=0'), { name: 'views', type: 'integer', default: 0 })
  assert.throws(() => parseFieldArg('x:string:bogus'), /Unknown modifier "bogus"/)
  const source = alterMigrationSource({ table: 'posts', up: ['        table.string("a");'], down: ['        table.dropColumn("a");'], ts: true })
  assert.match(source, /import type \{ Schema, AlterTableBuilder \}/)
  assert.match(source, /schema\.alterTable\("posts", \(table: AlterTableBuilder\) => \{\n        table\.string\("a"\);/)
})
