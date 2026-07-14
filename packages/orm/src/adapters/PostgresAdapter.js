import pg from "pg";
import { DatabaseAdapter } from "./DatabaseAdapter.js";

const COLUMN_TYPES = {
  increments: "SERIAL PRIMARY KEY",
  string: "TEXT",
  text: "TEXT",
  boolean: "BOOLEAN",
  integer: "INTEGER",
  date: "DATE",
  datetime: "TIMESTAMP",
  json: "JSONB",
  timestamp: "TIMESTAMP",
};

/**
 * Rewrites SQLite-style "?" placeholders into Postgres-style "$1, $2, ..."
 * positional placeholders, so Model.js and the migration runner can stay
 * driver-agnostic and never need to know which placeholder style is active.
 */
export function toPositionalPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/**
 * If an INSERT statement has no RETURNING clause, append one so we can
 * hand back an id the same way SqliteAdapter's lastInsertRowid does.
 */
export function ensureReturningId(sql) {
  const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
  const hasReturning = /RETURNING/i.test(sql);
  if (isInsert && !hasReturning) {
    return `${sql.trim().replace(/;$/, "")} RETURNING id`;
  }
  return sql;
}

export class PostgresAdapter extends DatabaseAdapter {
  constructor({ connectionString, host, port, user, password, database } = {}) {
    super();
    this.config = connectionString
      ? { connectionString }
      : { host, port, user, password, database };
    this.pool = null;
  }

  async connect() {
    this.pool = new pg.Pool(this.config);
    return this;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  ensureConnected() {
    if (!this.pool) {
      throw new Error("PostgresAdapter is not connected. Call connect() first.");
    }
  }

  async run(sql, params = []) {
    this.ensureConnected();
    const finalSql = toPositionalPlaceholders(ensureReturningId(sql));
    const result = await this.pool.query(finalSql, params);

    const lastInsertRowid = result.rows[0]?.id;
    return { ...result, lastInsertRowid };
  }

  async get(sql, params = []) {
    this.ensureConnected();
    const finalSql = toPositionalPlaceholders(sql);
    const result = await this.pool.query(finalSql, params);
    return result.rows[0] ?? null;
  }

  async all(sql, params = []) {
    this.ensureConnected();
    const finalSql = toPositionalPlaceholders(sql);
    const result = await this.pool.query(finalSql, params);
    return result.rows;
  }

  columnType(logicalType) {
    const sql = COLUMN_TYPES[logicalType];
    if (!sql) {
      throw new Error(`PostgresAdapter has no mapping for column type "${logicalType}"`);
    }
    return sql;
  }
}
