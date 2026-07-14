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

export function toPositionalPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

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

  async count(table) {
    this.ensureConnected();
    const result = await this.pool.query(`SELECT COUNT(*) as count FROM ${table}`);
    return Number(result.rows[0].count);
  }

  async paginate(table, limit, offset) {
    this.ensureConnected();
    const result = await this.pool.query(
      `SELECT * FROM ${table} ORDER BY id ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
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
