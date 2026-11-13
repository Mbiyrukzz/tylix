import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteAdapter } from './adapters/SqliteAdapter.js'
import { onQuery } from './instrumentation.js'

test('queries are timed only while someone listens, and errors are reported too', async () => {
  const db = await new SqliteAdapter({ filename: ':memory:' }).connect()
  await db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
  const events = []
  const stop = onQuery((event) => events.push(event))
  await db.run('INSERT INTO t (name) VALUES (?)', ['a'])
  await db.all('SELECT * FROM t')
  await assert.rejects(db.all('SELECT * FROM missing'))
  stop()
  await db.all('SELECT * FROM t')
  assert.equal(events.length, 3)
  assert.equal(events[0].driver, 'sqlite')
  assert.match(events[1].sql, /SELECT \* FROM t/)
  assert.ok(events[1].durationMs >= 0)
  assert.ok(events[2].error)
  await db.close()
})

test('SQLite reuses prepared statements, bounded, and survives schema changes', async () => {
  const db = await new SqliteAdapter({ filename: ':memory:' }).connect()
  await db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
  await db.run('INSERT INTO t (name) VALUES (?)', ['a'])
  await db.all('SELECT * FROM t')
  const cached = db.statements.get('SELECT * FROM t')
  await db.all('SELECT * FROM t')
  assert.equal(db.statements.get('SELECT * FROM t'), cached, 'same statement object reused')
  await db.run('ALTER TABLE t ADD COLUMN extra TEXT')
  assert.deepEqual(Object.keys((await db.all('SELECT * FROM t'))[0]), ['id', 'name', 'extra'])
  for (let i = 0; i < 600; i++) await db.get(`SELECT ${i} AS n`)
  assert.ok(db.statements.size <= 500)
  await db.close()
})

test('SQLite notices a migration made by another connection', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tylix-orm-')), 'db.sqlite')
  const app = await new SqliteAdapter({ filename: file }).connect()
  const migrate = await new SqliteAdapter({ filename: file }).connect()
  await migrate.run('CREATE TABLE t (id INTEGER PRIMARY KEY)')
  await migrate.run('INSERT INTO t DEFAULT VALUES')
  assert.deepEqual(Object.keys((await app.all('SELECT * FROM t'))[0]), ['id'])
  await migrate.run('ALTER TABLE t ADD COLUMN name TEXT')
  app.schemaCheckedAt = 0 // as if a second had passed
  assert.deepEqual(Object.keys((await app.all('SELECT * FROM t'))[0]), ['id', 'name'])
  await app.close()
  await migrate.close()
})

test('a failing query listener never breaks the query', async () => {
  const db = await new SqliteAdapter({ filename: ':memory:' }).connect()
  const stop = onQuery(() => {
    throw new Error('listener bug')
  })
  assert.deepEqual({ ...(await db.get('SELECT 1 AS one')) }, { one: 1 })
  stop()
  await db.close()
})
