import { DatabaseAdapter } from './DatabaseAdapter.js'
import { normalizeDatabaseError } from './DatabaseError.js'
import { emitQuery, hasQueryListeners } from '../instrumentation.js'

// Prepared statements kept per connection, so a repeated query skips
// SQLite's parse and plan step. Bounded: the oldest is dropped first.
// A prepared "SELECT *" keeps the columns it was prepared with, so the
// cache is cleared when the schema changes: at once for DDL run here, and
// within a second for a migration run by another process.
const STATEMENT_CACHE_SIZE = 500
const SCHEMA_CHECK_MS = 1000
const DDL = /^\s*(CREATE|ALTER|DROP)\b/i

const COLUMN_TYPES = {
  increments: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  string: 'TEXT',
  text: 'TEXT',
  boolean: 'INTEGER',
  integer: 'INTEGER',
  float: 'REAL',
  date: 'TEXT',
  datetime: 'TEXT',
  json: 'TEXT',
  timestamp: 'TEXT',
}

export class SqliteAdapter extends DatabaseAdapter {
  constructor({ filename = 'database.sqlite' } = {}) {
    super()
    this.filename = filename
    this.db = null
    this.statements = new Map()
    this.schemaVersion = null
    this.schemaCheckedAt = 0
  }

  async connect() {
    try {
      const { DatabaseSync } = await import('node:sqlite')
      this.db = new DatabaseSync(this.filename)
    } catch (err) {
      const error = normalizeDatabaseError('sqlite', err)
      error.detail = `Database file: ${this.filename}`
      throw error
    }
    return this
  }

  async close() {
    if (this.db) {
      this.statements.clear()
      this.db.close()
      this.db = null
    }
  }

  quoteIdentifier(name) {
    return `"${name.replace(/"/g, '""')}"`
  }

  ensureConnected() {
    if (!this.db) {
      throw new Error('SqliteAdapter is not connected. Call connect() first.')
    }
  }

  // The one place every statement runs through. SQLite reports most
  // mistakes (missing table or column, bad syntax) when the statement
  // is prepared, so prepare() is inside the try as well.
  execute(method, sql, params = []) {
    this.ensureConnected()
    const timed = hasQueryListeners()
    const start = timed ? performance.now() : 0
    try {
      const result = this.statement(sql)[method](...params)
      if (timed) emitQuery({ driver: 'sqlite', sql, durationMs: performance.now() - start })
      return result
    } catch (err) {
      if (timed) emitQuery({ driver: 'sqlite', sql, durationMs: performance.now() - start, error: err })
      throw normalizeDatabaseError('sqlite', err, { sql, params })
    }
  }

  statement(sql) {
    if (DDL.test(sql)) {
      this.statements.clear()
      this.schemaCheckedAt = 0
      return this.db.prepare(sql)
    }
    const now = Date.now()
    if (now - this.schemaCheckedAt > SCHEMA_CHECK_MS) {
      this.schemaCheckedAt = now
      const { schema_version: version } = this.db.prepare('PRAGMA schema_version').get()
      if (version !== this.schemaVersion) {
        // Reading the schema table makes SQLite reload this connection's
        // copy of the schema; reading the version alone does not, and new
        // statements would still be prepared against the old columns.
        if (this.schemaVersion !== null) this.db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get()
        this.statements.clear()
        this.schemaVersion = version
      }
    }
    let statement = this.statements.get(sql)
    if (statement) {
      // Most recently used goes last, so the first entry is the oldest.
      this.statements.delete(sql)
    } else {
      statement = this.db.prepare(sql)
      if (this.statements.size >= STATEMENT_CACHE_SIZE) {
        this.statements.delete(this.statements.keys().next().value)
      }
    }
    this.statements.set(sql, statement)
    return statement
  }

  async run(sql, params = []) {
    return this.execute('run', sql, params)
  }

  async get(sql, params = []) {
    return this.execute('get', sql, params) ?? null
  }

  async all(sql, params = []) {
    return this.execute('all', sql, params)
  }

  async count(table) {
    const row = this.execute('get', `SELECT COUNT(*) as count FROM ${table}`)
    return row.count
  }

  async paginate(table, limit, offset) {
    return this.execute(
      'all',
      `SELECT * FROM ${table} ORDER BY id ASC LIMIT ? OFFSET ?`,
      [limit, offset],
    )
  }

  async listTables() {
    const rows = this.execute(
      'all',
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    return rows.map((r) => r.name)
  }

  columnType(logicalType) {
    const sql = COLUMN_TYPES[logicalType]
    if (!sql) {
      throw new Error(
        `SqliteAdapter has no mapping for column type "${logicalType}"`,
      )
    }
    return sql
  }
}