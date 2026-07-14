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

  async count(table) {
    this.ensureConnected();
    const [rows] = await this.connection.execute(`SELECT COUNT(*) as count FROM ${table}`);
    return Number(rows[0].count);
  }

  async paginate(table, limit, offset) {
    this.ensureConnected();
    // mysql2 does not support ? placeholders for LIMIT/OFFSET reliably
    // across versions, so these are inlined after being forced to
    // integers here (never from raw user input) to avoid injection.
    const safeLimit = Number.isInteger(limit) ? limit : parseInt(limit, 10);
    const safeOffset = Number.isInteger(offset) ? offset : parseInt(offset, 10);
    const [rows] = await this.connection.execute(
      `SELECT * FROM ${table} ORDER BY id ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`
    );
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
