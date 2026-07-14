import mysql from "mysql2/promise";
import { DatabaseAdapter } from "./DatabaseAdapter.js";

const COLUMN_TYPES = {
  increments: "INT AUTO_INCREMENT PRIMARY KEY",
  string: "VARCHAR(255)",
  text: "TEXT",
  boolean: "TINYINT(1)",
  integer: "INT",
  date: "DATE",
  datetime: "DATETIME",
  json: "JSON",
  timestamp: "DATETIME",
};

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * MySQL's DATETIME columns reject ISO 8601 strings (the format Model.js
 * always produces via new Date().toISOString()). Converts them to
 * MySQL's "YYYY-MM-DD HH:MM:SS" format transparently, so Model.js and
 * every other adapter can stay driver-agnostic.
 */
export function toMysqlDateTime(value) {
  if (typeof value === "string" && ISO_DATETIME_PATTERN.test(value)) {
    return value.slice(0, 19).replace("T", " ");
  }
  return value;
}

export class MysqlAdapter extends DatabaseAdapter {
  constructor({ host, port, user, password, database } = {}) {
    super();
    this.config = { host, port, user, password, database };
    this.connection = null;
  }

  async connect() {
    this.connection = await mysql.createConnection(this.config);
    return this;
  }

  async close() {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
  }

  ensureConnected() {
    if (!this.connection) {
      throw new Error("MysqlAdapter is not connected. Call connect() first.");
    }
  }

  async run(sql, params = []) {
    this.ensureConnected();
    const converted = params.map(toMysqlDateTime);
    const [result] = await this.connection.execute(sql, converted);
    return { ...result, lastInsertRowid: result.insertId };
  }

  async get(sql, params = []) {
    this.ensureConnected();
    const converted = params.map(toMysqlDateTime);
    const [rows] = await this.connection.execute(sql, converted);
    return rows[0] ?? null;
  }

  async all(sql, params = []) {
    this.ensureConnected();
    const converted = params.map(toMysqlDateTime);
    const [rows] = await this.connection.execute(sql, converted);
    return rows;
  }

  columnType(logicalType) {
    const sql = COLUMN_TYPES[logicalType];
    if (!sql) {
      throw new Error(`MysqlAdapter has no mapping for column type "${logicalType}"`);
    }
    return sql;
  }
}
