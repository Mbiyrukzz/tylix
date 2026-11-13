import { buildSelectSql } from '../query/buildSelectSql.js'

/**
 * Base contract every Tylix database adapter must implement.
 * Concrete adapters (SqliteAdapter, PostgresAdapter, MysqlAdapter,
 * MongoAdapter...) extend this and implement each method. Model and the
 * migration runner only ever talk to this interface, never to a specific
 * driver.
 */
export class DatabaseAdapter {
  async connect() {
    throw new Error('connect() not implemented')
  }

  async close() {
    throw new Error('close() not implemented')
  }

  async run(sql, params = []) {
    throw new Error('run() not implemented')
  }

  async get(sql, params = []) {
    throw new Error('get() not implemented')
  }

  async all(sql, params = []) {
    throw new Error('all() not implemented')
  }

  columnType(logicalType) {
    throw new Error('columnType() not implemented')
  }

  // Updates the rows matching every field in `where`; resolves to how
  // many rows changed. One statement, so a check-and-set such as
  // { status: 'pending' } -> { status: 'processing' } is atomic.
  async updateWhere(table, values, where) {
    const q = (name) => this.quoteIdentifier(name)
    const sets = Object.keys(values).map((column) => `${q(column)} = ?`)
    const conditions = Object.keys(where).map((column) => `${q(column)} = ?`)
    if (sets.length === 0 || conditions.length === 0) throw new Error('updateWhere() needs values and at least one condition.')
    const result = await this.run(`UPDATE ${q(table)} SET ${sets.join(', ')} WHERE ${conditions.join(' AND ')}`, [
      ...Object.values(values),
      ...Object.values(where),
    ])
    return Number(result?.changes ?? result?.rowCount ?? result?.affectedRows ?? 0)
  }

  // Resolves when the database answers; used by /ready.
  async ping() {
    await this.get('SELECT 1')
  }

  async count(table) {
    throw new Error('count() not implemented')
  }

  async paginate(table, limit, offset) {
    throw new Error('paginate() not implemented')
  }

  async listTables() {
    throw new Error('listTables() not implemented')
  }

  /**
   * The SQL keyword used for LIKE conditions. Case-insensitive on MySQL and
   * SQLite already; PostgresAdapter overrides this with "ILIKE" so all SQL
   * drivers match the same rows.
   */
  get likeOperator() {
    return 'LIKE'
  }

  /**
   * Runs a structured query descriptor ({ wheres, orders, limitValue,
   * offsetValue }) against `table` and returns matching rows.
   *
   * Default implementation translates the descriptor to "?"-placeholder
   * SQL via buildSelectSql() and delegates to this.all(), which every
   * SQL adapter (Sqlite/Postgres/Mysql) already implements correctly
   * for its own placeholder dialect and type conversions. MongoAdapter
   * overrides this entirely since it has no SQL layer to delegate to.
   */
  async query(table, descriptor = {}) {
    const { sql, params } = buildSelectSql(table, descriptor, {
      likeOperator: this.likeOperator,
    })
    return this.all(sql, params)
  }
}