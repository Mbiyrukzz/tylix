import { Blueprint } from './Blueprint.js'
import {
  changeColumnSql,
  columnSql,
  commentSql,
  compileCreateTable,
  createIndexSql,
  dropForeignSql,
  dropIndexSql,
  foreignKeySql,
  indexName,
  quote,
  renameTableSql,
} from './grammar.js'

export { Blueprint, guessTable } from './Blueprint.js'
export * from './grammar.js'

const dialectOf = (adapter) => adapter.dialect ?? 'sqlite'
const isMysql = (d) => d === 'mysql' || d === 'mariadb'
const isPg = (d) => d === 'postgres' || d === 'cockroach'

const nameFor = (table, value, kind) => (Array.isArray(value) ? indexName(table, value, kind) : value)

// ---- introspection --------------------------------------------------------

async function tableExists(adapter, table) {
  const d = dialectOf(adapter)
  if (d === 'mongodb') return (await adapter.db.listCollections({ name: table }).toArray()).length > 0
  if (d === 'sqlite') return Boolean(await adapter.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]))
  if (isPg(d)) {
    return Boolean(await adapter.get('SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?', [table]))
  }
  return Boolean(await adapter.get('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]))
}

async function columnNames(adapter, table) {
  const d = dialectOf(adapter)
  if (d === 'mongodb') {
    const doc = await adapter.db.collection(table).findOne({})
    return doc ? Object.keys(doc).filter((k) => k !== '_id') : []
  }
  if (d === 'sqlite') return (await adapter.all(`PRAGMA table_info(${quote(d, table)})`)).map((c) => c.name)
  const rows = isPg(d)
    ? await adapter.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position', [table])
    : await adapter.all('SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position', [table])
  return rows.map((r) => r.column_name ?? r.COLUMN_NAME)
}

async function indexNames(adapter, table) {
  const d = dialectOf(adapter)
  if (d === 'mongodb') return (await adapter.db.collection(table).indexes()).map((i) => i.name)
  if (d === 'sqlite') return (await adapter.all(`PRAGMA index_list(${quote(d, table)})`)).map((i) => i.name)
  if (isPg(d)) return (await adapter.all('SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?', [table])).map((r) => r.indexname)
  const rows = await adapter.all('SELECT DISTINCT index_name AS index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ?', [table])
  return rows.map((r) => r.index_name ?? r.INDEX_NAME)
}

// ---- SQLite: rebuilding a table ------------------------------------------
//
// SQLite can't change a column's type, nullability or default, or drop a
// foreign key, in place. The usual way (the one its documentation gives)
// is: create the new table, copy the rows, drop the old one, rename the
// new one, and recreate its indexes. It runs inside the migration's
// transaction.

async function sqliteRebuild(adapter, table, { change = [], drop = [], addForeign = [], dropForeign = [] }) {
  const d = 'sqlite'
  const q = (n) => quote(d, n)
  const info = await adapter.all(`PRAGMA table_info(${q(table)})`)
  if (info.length === 0) throw new Error(`Table "${table}" does not exist.`)
  const master = await adapter.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table])
  const autoincrement = /AUTOINCREMENT/i.test(master?.sql ?? '')
  const pkColumns = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
  const changed = new Map(change.map((c) => [c.name, c]))
  const dropped = new Set(drop)

  const defs = []
  const kept = []
  for (const col of info) {
    if (dropped.has(col.name)) continue
    kept.push(col.name)
    if (changed.has(col.name)) {
      defs.push(columnSql(d, changed.get(col.name)))
      continue
    }
    let def = `${q(col.name)} ${col.type || 'TEXT'}`
    if (pkColumns.length === 1 && col.pk === 1) {
      def += autoincrement && /^INTEGER$/i.test(col.type) ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY'
    } else {
      if (col.notnull) def += ' NOT NULL'
      if (col.dflt_value !== null && col.dflt_value !== undefined) def += ` DEFAULT ${col.dflt_value}`
    }
    defs.push(def)
  }
  if (pkColumns.length > 1) defs.push(`PRIMARY KEY (${pkColumns.map((c) => q(c.name)).join(', ')})`)

  // Foreign keys: the existing ones (minus those dropped or on dropped
  // columns), plus new ones.
  const fkRows = await adapter.all(`PRAGMA foreign_key_list(${q(table)})`)
  const groups = new Map()
  for (const row of fkRows) {
    if (!groups.has(row.id)) groups.set(row.id, { columns: [], refColumns: [], table: row.table, onDelete: row.on_delete, onUpdate: row.on_update })
    const g = groups.get(row.id)
    g.columns.push(row.from)
    g.refColumns.push(row.to)
  }
  const dropFk = dropForeign.map((v) => (Array.isArray(v) ? v.join(',') : v))
  for (const fk of groups.values()) {
    if (fk.columns.some((c) => dropped.has(c))) continue
    const key = fk.columns.join(',')
    if (dropFk.includes(key) || dropFk.includes(indexName(table, fk.columns, 'foreign'))) continue
    const actions = [
      fk.onDelete && fk.onDelete !== 'NO ACTION' ? ` ON DELETE ${fk.onDelete}` : '',
      fk.onUpdate && fk.onUpdate !== 'NO ACTION' ? ` ON UPDATE ${fk.onUpdate}` : '',
    ].join('')
    defs.push(`FOREIGN KEY (${fk.columns.map(q).join(', ')}) REFERENCES ${q(fk.table)} (${fk.refColumns.map(q).join(', ')})${actions}`)
  }
  for (const fk of addForeign) defs.push(foreignKeySql(d, table, fk))

  // Indexes to recreate afterwards.
  const recreate = []
  for (const idx of await adapter.all(`PRAGMA index_list(${q(table)})`)) {
    if (idx.origin === 'pk') continue
    const cols = (await adapter.all(`PRAGMA index_info(${q(idx.name)})`)).map((c) => c.name)
    if (cols.some((c) => dropped.has(c))) continue
    if (idx.origin === 'c') {
      const row = await adapter.get("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", [idx.name])
      if (row?.sql) recreate.push(row.sql)
    } else {
      recreate.push(createIndexSql(d, table, { columns: cols, unique: Boolean(idx.unique) }))
    }
  }

  const temp = `__tylix_rebuild_${table}`
  await adapter.run(`PRAGMA defer_foreign_keys = ON`)
  await adapter.run(`DROP TABLE IF EXISTS ${q(temp)}`)
  await adapter.run(`CREATE TABLE ${q(temp)} (${defs.join(', ')})`)
  const list = kept.map(q).join(', ')
  await adapter.run(`INSERT INTO ${q(temp)} (${list}) SELECT ${list} FROM ${q(table)}`)
  await adapter.run(`DROP TABLE ${q(table)}`)
  await adapter.run(`ALTER TABLE ${q(temp)} RENAME TO ${q(table)}`)
  for (const sql of recreate) await adapter.run(sql)
}

// ---- MongoDB --------------------------------------------------------------
// Collections have no columns: only indexes, renames and dropped fields
// mean anything there.

function mongoSchema(adapter) {
  const db = () => adapter.db
  const ensure = async (table) => {
    if (!(await tableExists(adapter, table))) await db().createCollection(table)
  }
  const applyIndexes = async (table, blueprint) => {
    for (const index of blueprint.indexes) {
      const keys = Object.fromEntries(index.columns.map((c) => [c, 1]))
      await db().collection(table).createIndex(keys, {
        unique: index.unique,
        name: index.name ?? indexName(table, index.columns, index.unique ? 'unique' : 'index'),
      })
    }
  }
  return {
    async createTable(table, callback) {
      const blueprint = new Blueprint(table)
      await callback(blueprint)
      await ensure(table)
      await applyIndexes(table, blueprint)
    },
    async alterTable(table, callback) {
      const blueprint = new Blueprint(table, { alter: true })
      await callback(blueprint)
      const collection = db().collection(table)
      for (const value of [...blueprint.drops.indexes, ...blueprint.drops.uniques]) {
        const name = nameFor(table, value, blueprint.drops.uniques.includes(value) ? 'unique' : 'index')
        await collection.dropIndex(name).catch(() => {})
      }
      if (blueprint.renames.length) {
        await collection.updateMany({}, { $rename: Object.fromEntries(blueprint.renames.map((r) => [r.from, r.to])) })
      }
      for (const column of blueprint.columns) {
        if (column.default !== undefined && !column.change && typeof column.default !== 'object') {
          await collection.updateMany({ [column.name]: { $exists: false } }, { $set: { [column.name]: column.default } })
        }
      }
      if (blueprint.drops.columns.length) {
        await collection.updateMany({}, { $unset: Object.fromEntries(blueprint.drops.columns.map((c) => [c, ''])) })
      }
      await applyIndexes(table, blueprint)
    },
    async dropTable(table) {
      if (await tableExists(adapter, table)) await db().collection(table).drop()
    },
    async renameTable(from, to) {
      await db().collection(from).rename(to)
    },
    hasTable: (table) => tableExists(adapter, table),
    async hasColumn(table, column) {
      return Boolean(await db().collection(table).findOne({ [column]: { $exists: true } }))
    },
    getColumns: (table) => columnNames(adapter, table),
    getIndexes: (table) => indexNames(adapter, table),
    async raw() {
      throw new Error('schema.raw() runs SQL, and MongoDB has none. Use adapter.db (the MongoDB driver) in the migration instead.')
    },
  }
}

// ---- SQL ------------------------------------------------------------------

export function createSchema(adapter) {
  const d = dialectOf(adapter)
  if (d === 'mongodb') return withAliases(mongoSchema(adapter))
  const q = (n) => quote(d, n)
  const run = (sql, params) => adapter.run(sql, params)

  async function alterTable(table, callback) {
    const blueprint = new Blueprint(table, { alter: true })
    await callback(blueprint)
    const { columns, indexes, foreignKeys, drops, renames } = blueprint
    const added = columns.filter((c) => !c.change)
    const changed = columns.filter((c) => c.change)
    const newForeign = foreignKeys.filter((fk) => fk.table)
    const addedNames = new Set(added.map((c) => c.name))

    // 1. Foreign keys and indexes that go away come off first, so the
    //    columns under them can change or be dropped.
    for (const value of drops.foreign) {
      if (d === 'sqlite') continue // part of the rebuild below
      await run(dropForeignSql(d, table, nameFor(table, value, 'foreign')))
    }
    for (const value of drops.indexes) await run(dropIndexSql(d, table, nameFor(table, value, 'index')))
    for (const value of drops.uniques) await run(dropIndexSql(d, table, nameFor(table, value, 'unique'), { unique: true }))

    // 2. Renames.
    for (const { from, to } of renames) await run(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(from)} TO ${q(to)}`)

    // 3. New columns. A foreign key on a new SQLite column goes in the
    //    column itself (SQLite can add a column with REFERENCES).
    for (const column of added) {
      const inline = { references: d === 'sqlite' }
      const ifNotExists = d === 'mariadb' || d === 'postgres' || d === 'cockroach' ? 'IF NOT EXISTS ' : ''
      await run(`ALTER TABLE ${q(table)} ADD COLUMN ${ifNotExists}${columnSql(d, column, { inline })}`)
      const comment = commentSql(d, table, column)
      if (comment) await run(comment)
    }

    // 4. Changed and dropped columns, and SQLite foreign-key changes.
    const sqliteForeign = d === 'sqlite' ? newForeign.filter((fk) => !fk.columns.every((c) => addedNames.has(c))) : []
    if (d === 'sqlite' && (changed.length || sqliteForeign.length || drops.foreign.length)) {
      await sqliteRebuild(adapter, table, { change: changed, drop: drops.columns, addForeign: sqliteForeign, dropForeign: drops.foreign })
    } else {
      for (const column of changed) {
        for (const sql of changeColumnSql(d, table, column)) await run(sql)
        const comment = commentSql(d, table, column)
        if (comment) await run(comment)
      }
      for (const name of drops.columns) {
        if (d === 'sqlite') {
          // SQLite can't drop an indexed column: drop its indexes first,
          // and rebuild when a constraint still holds it.
          await sqliteDropColumn(adapter, table, name)
        } else {
          await run(`ALTER TABLE ${q(table)} DROP COLUMN ${q(name)}`)
        }
      }
    }

    // 5. New indexes and foreign keys.
    for (const index of indexes) await run(createIndexSql(d, table, index))
    if (d !== 'sqlite') {
      for (const fk of newForeign) await run(`ALTER TABLE ${q(table)} ADD ${foreignKeySql(d, table, fk)}`)
    }
  }

  async function sqliteDropColumn(adapter, table, name) {
    for (const idx of await adapter.all(`PRAGMA index_list(${q(table)})`)) {
      if (idx.origin !== 'c') continue
      const cols = (await adapter.all(`PRAGMA index_info(${q(idx.name)})`)).map((c) => c.name)
      if (cols.includes(name)) await run(`DROP INDEX IF EXISTS ${q(idx.name)}`)
    }
    try {
      await run(`ALTER TABLE ${q(table)} DROP COLUMN ${q(name)}`)
    } catch {
      await sqliteRebuild(adapter, table, { drop: [name] })
    }
  }

  return withAliases({
    async createTable(table, callback, options) {
      const blueprint = new Blueprint(table)
      await callback(blueprint)
      if (blueprint.columns.length === 0) throw new Error(`schema.createTable("${table}") has no columns.`)
      for (const sql of compileCreateTable(d, table, blueprint, options)) await run(sql)
    },
    alterTable,
    async dropTable(table) {
      await run(`DROP TABLE IF EXISTS ${q(table)}${isPg(d) ? ' CASCADE' : ''}`)
    },
    async renameTable(from, to) {
      await run(renameTableSql(d, from, to))
    },
    hasTable: (table) => tableExists(adapter, table),
    async hasColumn(table, column) {
      return (await columnNames(adapter, table)).includes(column)
    },
    getColumns: (table) => columnNames(adapter, table),
    getIndexes: (table) => indexNames(adapter, table),
    // For statements the builder can't express.
    async raw(sql, params = []) {
      await run(sql, params)
    },
    dialect: d,
  })
}

// Laravel's names work too: schema.create, schema.table, schema.dropIfExists.
function withAliases(schema) {
  return {
    ...schema,
    create: schema.createTable,
    table: schema.alterTable,
    drop: schema.dropTable,
    dropIfExists: schema.dropTable,
    rename: schema.renameTable,
    async dropColumnIfExists(table, column) {
      if (await schema.hasColumn(table, column)) await schema.alterTable(table, (t) => t.dropColumn(column))
    },
  }
}

export { isMysql as isMysqlDialect, isPg as isPostgresDialect }
