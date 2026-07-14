import { buildSelectSql } from "../query/buildSelectSql.js";

/**
 * Base contract every Tylix database adapter must implement.
 * Concrete adapters (SqliteAdapter, PostgresAdapter, MysqlAdapter,
 * MongoAdapter...) extend this and implement each method. Model and the
 * migration runner only ever talk to this interface, never to a specific
 * driver.
 */
export class DatabaseAdapter {
  async connect() {
    throw new Error("connect() not implemented");
  }

  async close() {
    throw new Error("close() not implemented");
  }

  async run(sql, params = []) {
    throw new Error("run() not implemented");
  }

  async get(sql, params = []) {
    throw new Error("get() not implemented");
  }

  async all(sql, params = []) {
    throw new Error("all() not implemented");
  }

  columnType(logicalType) {
    throw new Error("columnType() not implemented");
  }

  async count(table) {
    throw new Error("count() not implemented");
  }

  async paginate(table, limit, offset) {
    throw new Error("paginate() not implemented");
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
    const { sql, params } = buildSelectSql(table, descriptor);
    return this.all(sql, params);
  }
}
