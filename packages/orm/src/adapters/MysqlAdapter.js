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
    const [result] = await this.connection.execute(sql, params);
    // mysql2 returns insertId directly on the result object for INSERTs.
    return { ...result, lastInsertRowid: result.insertId };
  }

  async get(sql, params = []) {
    this.ensureConnected();
    const [rows] = await this.connection.execute(sql, params);
    return rows[0] ?? null;
  }

  async all(sql, params = []) {
    this.ensureConnected();
    const [rows] = await this.connection.execute(sql, params);
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
