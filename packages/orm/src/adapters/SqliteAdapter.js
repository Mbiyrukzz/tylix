import { DatabaseAdapter } from "./DatabaseAdapter.js";

const COLUMN_TYPES = {
  increments: "INTEGER PRIMARY KEY AUTOINCREMENT",
  string: "TEXT",
  text: "TEXT",
  boolean: "INTEGER",
  integer: "INTEGER",
  date: "TEXT",
  datetime: "TEXT",
  json: "TEXT",
  timestamp: "TEXT",
};

export class SqliteAdapter extends DatabaseAdapter {
  constructor({ filename = "database.sqlite" } = {}) {
    super();
    this.filename = filename;
    this.db = null;
  }

  async connect() {
    const { DatabaseSync } = await import("node:sqlite");
    this.db = new DatabaseSync(this.filename);
    return this;
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  ensureConnected() {
    if (!this.db) {
      throw new Error("SqliteAdapter is not connected. Call connect() first.");
    }
  }

  async run(sql, params = []) {
    this.ensureConnected();
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  async get(sql, params = []) {
    this.ensureConnected();
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) ?? null;
  }

  async all(sql, params = []) {
    this.ensureConnected();
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  async count(table) {
    this.ensureConnected();
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    return row.count;
  }

  async paginate(table, limit, offset) {
    this.ensureConnected();
    const stmt = this.db.prepare(`SELECT * FROM ${table} ORDER BY id ASC LIMIT ? OFFSET ?`);
    return stmt.all(limit, offset);
  }

  columnType(logicalType) {
    const sql = COLUMN_TYPES[logicalType];
    if (!sql) {
      throw new Error(`SqliteAdapter has no mapping for column type "${logicalType}"`);
    }
    return sql;
  }
}
