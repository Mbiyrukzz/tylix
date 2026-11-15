import mysql from 'mysql2/promise'
import { DatabaseAdapter } from './DatabaseAdapter.js'
import { normalizeDatabaseError } from './DatabaseError.js'
import { emitQuery, hasQueryListeners } from '../instrumentation.js'

const COLUMN_TYPES = {
  increments: 'INT AUTO_INCREMENT PRIMARY KEY',
  string: 'VARCHAR(255)',
  text: 'TEXT',
  mediumText: 'MEDIUMTEXT',
  longText: 'LONGTEXT',
  boolean: 'TINYINT(1)',
  integer: 'INT',
  float: 'DOUBLE',
  date: 'DATE',
  datetime: 'DATETIME',
  json: 'JSON',
  timestamp: 'DATETIME',
}

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export function toMysqlDateTime(value) {
  if (typeof value === 'string' && ISO_DATETIME_PATTERN.test(value)) {
    return value.slice(0, 19).replace('T', ' ')
  }
  return value
}

export class MysqlAdapter extends DatabaseAdapter {
  constructor({ host, port, user, password, database } = {}) {
    super()
    this.config = { host, port, user, password, database }
    this.connection = null
  }

  get dialect() {
    return 'mysql'
  }

  get driverName() {
    return 'mysql'
  }

  async connect() {
    this.connection = mysql.createPool({
      ...this.config,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    })
    try {
      const conn = await this.connection.getConnection() // fail fast on bad credentials
      conn.release()
    } catch (err) {
      const error = normalizeDatabaseError(this.driverName, err)
      const { host, port, user, database } = this.config
      error.detail = `Tried ${host}:${port} as "${user}", database "${database}"`
      await this.connection.end().catch(() => {})
      this.connection = null
      throw error
    }
    return this
  }

  async close() {
    if (this.connection) {
      await this.connection.end()
      this.connection = null
    }
  }

  quoteIdentifier(name) {
    return `\`${name.replace(/`/g, '``')}\``
  }

  ensureConnected() {
    if (!this.connection) {
      throw new Error('MysqlAdapter is not connected. Call connect() first.')
    }
  }

  // The one place every statement runs through, so every MySQL failure
  // is translated into a DatabaseError that carries the SQL.
  async execute(sql, params = []) {
    this.ensureConnected()
    const converted = params.map(toMysqlDateTime)
    const timed = hasQueryListeners()
    const start = timed ? performance.now() : 0
    try {
      const [result] = await this.connection.execute(sql, converted)
      if (timed) emitQuery({ driver: this.driverName, sql, durationMs: performance.now() - start })
      return result
    } catch (err) {
      if (timed) emitQuery({ driver: this.driverName, sql, durationMs: performance.now() - start, error: err })
      throw normalizeDatabaseError(this.driverName, err, { sql, params: converted })
    }
  }

  async run(sql, params = []) {
    const result = await this.execute(sql, params)
    return { ...result, lastInsertRowid: result.insertId }
  }

  async get(sql, params = []) {
    const rows = await this.execute(sql, params)
    return rows[0] ?? null
  }

  async all(sql, params = []) {
    return this.execute(sql, params)
  }

  async count(table) {
    const rows = await this.execute(`SELECT COUNT(*) as count FROM ${table}`)
    return Number(rows[0].count)
  }

  async paginate(table, limit, offset) {
    // mysql2 does not support ? placeholders for LIMIT/OFFSET reliably
    // across versions, so these are inlined after being forced to
    // integers here (never from raw user input) to avoid injection.
    const safeLimit = Number.isInteger(limit) ? limit : parseInt(limit, 10)
    const safeOffset = Number.isInteger(offset) ? offset : parseInt(offset, 10)
    return this.execute(
      `SELECT * FROM ${table} ORDER BY id ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    )
  }

  async listTables() {
    const rows = await this.execute('SHOW TABLES')
    return rows.map((r) => Object.values(r)[0])
  }

  columnType(logicalType) {
    const sql = COLUMN_TYPES[logicalType]
    if (!sql) {
      throw new Error(
        `MysqlAdapter has no mapping for column type "${logicalType}"`,
      )
    }
    return sql
  }
}