import { DatabaseAdapter } from './DatabaseAdapter.js'
import { normalizeDatabaseError } from './DatabaseError.js'

const COLUMN_TYPES = {
  increments: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  string: 'TEXT',
  text: 'TEXT',
  boolean: 'INTEGER',
  integer: 'INTEGER',
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
    try {
      return this.db.prepare(sql)[method](...params)
    } catch (err) {
      throw normalizeDatabaseError('sqlite', err, { sql, params })
    }
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