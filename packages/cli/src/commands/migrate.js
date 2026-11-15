import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSchema } from '@tylix/orm'
import { detectLanguage } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'

// tylix migrate and friends, as in Laravel:
//
//   tylix migrate                 run new migrations, as one batch
//   tylix migrate:status          which have run, in which batch
//   tylix migrate:rollback        undo the last batch (--step=N: the last N migrations)
//   tylix migrate:reset           undo every migration
//   tylix migrate:refresh         reset, then migrate
//   tylix migrate:fresh           drop every table, then migrate
//
// --seed (refresh, fresh) runs the seeders after. In production the
// commands that undo or drop need --force.
//
// On SQLite and PostgreSQL each migration runs in a transaction, so one
// that fails changes nothing. MySQL, MariaDB and CockroachDB can't roll
// back schema changes; there a failed migration may leave part of its work.

const TRANSACTIONAL = new Set(['sqlite', 'postgres'])

// Kept for code that imported the old builder from here.
export function buildSchema(adapter) {
  return createSchema(adapter)
}

async function setupTable(adapter, schema) {
  await adapter.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id ${adapter.columnType('increments')},
      filename VARCHAR(255) NOT NULL UNIQUE,
      run_at TEXT NOT NULL
    )
  `)
  // Tables made before rollbacks existed have no batch: everything they
  // hold counts as batch 1.
  if (adapter.dialect !== 'mongodb' && !(await schema.hasColumn('migrations', 'batch'))) {
    await schema.alterTable('migrations', (table) => table.integer('batch'))
    await adapter.run('UPDATE migrations SET batch = 1 WHERE batch IS NULL')
  }
}

async function ranMigrations(adapter) {
  const rows = await adapter.all('SELECT * FROM migrations')
  return rows
    .map((row) => ({ filename: row.filename, batch: Number(row.batch ?? 1), runAt: row.run_at }))
    .sort((a, b) => a.batch - b.batch || a.filename.localeCompare(b.filename))
}

async function migrationFiles(cwd) {
  const language = await detectLanguage(cwd)
  const extension = language === 'typescript' ? '.ts' : '.js'
  const dir = path.join(cwd, 'database', 'migrations')
  const files = await fs.readdir(dir).catch(() => null)
  if (!files) return { dir, files: null }
  return { dir, files: files.filter((f) => f.endsWith(extension) && !f.endsWith(`.d${extension}`)).sort() }
}

async function load(dir, file) {
  const migration = await import(pathToFileURL(path.join(dir, file)).href)
  if (typeof migration.up !== 'function') throw new Error(`${file} has no up(schema) export.`)
  return migration
}

// Runs one step of a migration, in a transaction where that works.
async function step(adapter, fn) {
  if (TRANSACTIONAL.has(adapter.dialect) && typeof adapter.transaction === 'function') return adapter.transaction(fn)
  return fn()
}

function labelled(file, direction, err) {
  err.message = `${file} ${direction}() failed: ${err.message}`
  return err
}

async function withDatabase(fn) {
  const cwd = process.cwd()
  const adapter = await bootstrapDatabase(cwd)
  try {
    const schema = createSchema(adapter)
    await setupTable(adapter, schema)
    return await fn({ cwd, adapter, schema })
  } finally {
    await adapter.close()
  }
}

async function runUp({ cwd, adapter, schema }) {
  const { dir, files } = await migrationFiles(cwd)
  if (!files) {
    console.log('No migrations directory found.')
    return 0
  }
  const ran = await ranMigrations(adapter)
  const done = new Set(ran.map((r) => r.filename))
  const batch = Math.max(0, ...ran.map((r) => r.batch)) + 1
  let count = 0
  for (const file of files) {
    if (done.has(file)) continue
    const migration = await load(dir, file)
    const started = Date.now()
    try {
      await step(adapter, async () => {
        await migration.up(schema, { adapter })
        await adapter.run('INSERT INTO migrations (filename, run_at, batch) VALUES (?, ?, ?)', [file, new Date().toISOString(), batch])
      })
    } catch (err) {
      throw labelled(file, 'up', err)
    }
    console.log(`✔ Migrated: ${file} ${dim(`(${Date.now() - started}ms)`)}`)
    count++
  }
  if (count === 0) console.log('Nothing to migrate.')
  return count
}

async function runDown({ cwd, adapter, schema }, targets) {
  const { dir, files } = await migrationFiles(cwd)
  const present = new Set(files ?? [])
  let count = 0
  for (const { filename } of targets) {
    if (!present.has(filename)) {
      console.log(`⚠ ${filename} is recorded as run but the file is gone; only its record was removed.`)
      await adapter.run('DELETE FROM migrations WHERE filename = ?', [filename])
      continue
    }
    const migration = await load(dir, filename)
    if (typeof migration.down !== 'function') throw new Error(`${filename} has no down(schema) export, so it can't be rolled back.`)
    try {
      await step(adapter, async () => {
        await migration.down(schema, { adapter })
        await adapter.run('DELETE FROM migrations WHERE filename = ?', [filename])
      })
    } catch (err) {
      throw labelled(filename, 'down', err)
    }
    console.log(`↩ Rolled back: ${filename}`)
    count++
  }
  if (count === 0 && targets.length === 0) console.log('Nothing to roll back.')
  return count
}

const dim = (text) => (process.stdout.isTTY ? `\x1b[90m${text}\x1b[0m` : text)

function guardProduction(force, command) {
  if (process.env.NODE_ENV === 'production' && !force) {
    throw new Error(`"tylix ${command}" changes or drops data. In production, pass --force to run it.`)
  }
}

async function seed() {
  const { dbSeed } = await import('./dbSeed.js')
  await dbSeed()
}

export async function migrate() {
  await withDatabase((ctx) => runUp(ctx))
}

export async function migrateRollback({ step: steps, force = false } = {}) {
  guardProduction(force, 'migrate:rollback')
  await withDatabase(async (ctx) => {
    const ran = await ranMigrations(ctx.adapter)
    let targets
    if (steps) targets = ran.slice(-steps)
    else {
      const last = Math.max(0, ...ran.map((r) => r.batch))
      targets = ran.filter((r) => r.batch === last)
    }
    await runDown(ctx, targets.reverse())
  })
}

export async function migrateReset({ force = false } = {}) {
  guardProduction(force, 'migrate:reset')
  await withDatabase(async (ctx) => runDown(ctx, (await ranMigrations(ctx.adapter)).reverse()))
}

export async function migrateRefresh({ force = false, seed: withSeed = false } = {}) {
  guardProduction(force, 'migrate:refresh')
  await withDatabase(async (ctx) => {
    await runDown(ctx, (await ranMigrations(ctx.adapter)).reverse())
    await runUp(ctx)
  })
  if (withSeed) await seed()
}

export async function migrateFresh({ force = false, seed: withSeed = false } = {}) {
  guardProduction(force, 'migrate:fresh')
  const cwd = process.cwd()
  const adapter = await bootstrapDatabase(cwd)
  try {
    const schema = createSchema(adapter)
    const tables = await adapter.listTables()
    const mysql = adapter.dialect === 'mysql' || adapter.dialect === 'mariadb'
    if (mysql) await adapter.run('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of tables) {
      if (table.startsWith('system.')) continue
      await schema.dropTable(table)
    }
    if (mysql) await adapter.run('SET FOREIGN_KEY_CHECKS = 1')
    console.log(`✔ Dropped ${tables.length} table(s).`)
    await setupTable(adapter, schema)
    await runUp({ cwd, adapter, schema })
  } finally {
    await adapter.close()
  }
  if (withSeed) await seed()
}

export async function migrateStatus() {
  await withDatabase(async ({ cwd, adapter }) => {
    const { files } = await migrationFiles(cwd)
    const ran = new Map((await ranMigrations(adapter)).map((r) => [r.filename, r]))
    const all = [...new Set([...(files ?? []), ...ran.keys()])].sort()
    if (all.length === 0) {
      console.log('No migrations.')
      return
    }
    const width = Math.max(...all.map((f) => f.length))
    console.log(`${'Migration'.padEnd(width)}  Batch  Status`)
    for (const file of all) {
      const row = ran.get(file)
      const status = row ? (files?.includes(file) ? 'Ran' : 'Ran (file missing)') : 'Pending'
      console.log(`${file.padEnd(width)}  ${String(row?.batch ?? '').padEnd(5)}  ${status}`)
    }
  })
}
