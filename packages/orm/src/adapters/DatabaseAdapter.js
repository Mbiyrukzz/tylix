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

  /**
   * Returns the total row/document count for a table/collection.
   */
  async count(table) {
    throw new Error("count() not implemented");
  }

  /**
   * Returns a page of rows/documents for a table/collection, ordered by
   * insertion order (id ascending for SQL, natural order for Mongo).
   */
  async paginate(table, limit, offset) {
    throw new Error("paginate() not implemented");
  }
}
