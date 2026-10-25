import pg from 'pg'
import { DatabaseAdapter } from './DatabaseAdapter.js'
import { normalizeDatabaseError } from './DatabaseError.js'

const COLUMN_TYPES = {
  increments: 'SERIAL PRIMARY KEY',
  string: 'TEXT',
  text: 'TEXT',
  boolean: 'BOOLEAN',
  integer: 'INTEGER',
  date: 'DATE',
  datetime: 'TIMESTAMP',
  json: 'JSONB',
  timestamp: 'TIMESTAMP',
}

export function toPositionalPlaceholders(sql) {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

export function ensureReturningId(sql) {
  const isInsert = /^\s*INSERT\s+INTO/i.test(sql)
  const hasReturning = /RETURNING/i.test(sql)
  if (isInsert && !hasReturning) {
    return `${sql.trim().replace(/;$/, '')} RETURNING id`
  }
  return sql
}

export class PostgresAdapter extends DatabaseAdapter {
  constructor({ connectionString, host, port, user, password, database } = {}) {
    super()
    this.config = connectionString
      ? { connectionString }
      : { host, port, user, password, database }
    this.pool = null
  }

  async connect() {
    this.pool = new pg.Pool(this.config)
    try {
      // pg connects lazily, so test it now. A wrong password or a
      // stopped server should fail at startup, not on the first request.
      const client = await this.pool.connect()
      client.release()
    } catch (err) {
      const error = normalizeDatabaseError('postgres', err)
      const { host, port, user, database } = this.config
      error.detail = this.config.connectionString
        ? 'Using DATABASE_URL connection string'
        : `Tried ${host}:${port} as "${user}", database "${database}"`
      await this.pool.end().catch(() => {})
      this.pool = null
      throw error
    }
    return this
  }

  async close() {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }

  quoteIdentifier(name) {
    return `"${name.replace(/"/g, '""')}"`
  }

  ensureConnected() {
    if (!this.pool) {
      throw new Error('PostgresAdapter is not connected. Call connect() first.')
    }
  }

  // The one place every statement runs through. `sql` here is the final
  // SQL (with $1, $2 placeholders), exactly what PostgreSQL received.
  async execute(sql, params = []) {
    this.ensureConnected()
    try {
      return await this.pool.query(sql, params)
    } catch (err) {
      throw normalizeDatabaseError('postgres', err, { sql, params })
    }
  }

  async run(sql, params = []) {
    const result = await this.execute(
      toPositionalPlaceholders(ensureReturningId(sql)),
      params,
    )
    const lastInsertRowid = result.rows[0]?.id
    return { ...result, lastInsertRowid }
  }

  async get(sql, params = []) {
    const result = await this.execute(toPositionalPlaceholders(sql), params)
    return result.rows[0] ?? null
  }

  async all(sql, params = []) {
    const result = await this.execute(toPositionalPlaceholders(sql), params)
    return result.rows
  }

  async count(table) {
    const result = await this.execute(`SELECT COUNT(*) as count FROM ${table}`)
    return Number(result.rows[0].count)
  }

  async paginate(table, limit, offset) {
    const result = await this.execute(
      `SELECT * FROM ${table} ORDER BY id ASC LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    return result.rows
  }

  async listTables() {
    const result = await this.execute(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )
    return result.rows.map((r) => r.tablename)
  }

  columnType(logicalType) {
    const sql = COLUMN_TYPES[logicalType]
    if (!sql) {
      throw new Error(
        `PostgresAdapter has no mapping for column type "${logicalType}"`,
      )
    }
    return sql
  }
}