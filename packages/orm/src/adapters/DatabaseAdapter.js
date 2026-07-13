/**
 * Base contract every Tylix database adapter must implement.
 * Concrete adapters (SqliteAdapter, PostgresAdapter, MysqlAdapter...)
 * extend this and implement each method. Model and Schema only ever
 * talk to this interface, never to a specific driver.
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
}
