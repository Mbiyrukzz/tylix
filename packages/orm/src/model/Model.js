import { ConnectionManager } from "./ConnectionManager.js";

export class Model {
  static table = null;
  static fillable = [];

  static getTable() {
    if (!this.table) {
      throw new Error(`${this.name} must define a static "table" property.`);
    }
    return this.table;
  }

  static async all() {
    const adapter = ConnectionManager.getAdapter();
    return adapter.all(`SELECT * FROM ${this.getTable()}`);
  }

  static async find(id) {
    const adapter = ConnectionManager.getAdapter();
    return adapter.get(`SELECT * FROM ${this.getTable()} WHERE id = ?`, [id]);
  }

  static async create(data) {
    const adapter = ConnectionManager.getAdapter();
    const fields = this.fillable.filter((f) => f in data);

    if (fields.length === 0) {
      throw new Error(`No fillable fields provided for ${this.name}.create()`);
    }

    const columns = fields.join(", ");
    const placeholders = fields.map(() => "?").join(", ");
    const values = fields.map((f) => data[f]);

    const result = await adapter.run(
      `INSERT INTO ${this.getTable()} (${columns}) VALUES (${placeholders})`,
      values
    );

    return this.find(result.lastInsertRowid);
  }

  static async update(id, data) {
    const adapter = ConnectionManager.getAdapter();
    const fields = this.fillable.filter((f) => f in data);

    if (fields.length === 0) {
      throw new Error(`No fillable fields provided for ${this.name}.update()`);
    }

    const setClause = fields.map((f) => `${f} = ?`).join(", ");
    const values = fields.map((f) => data[f]);

    await adapter.run(
      `UPDATE ${this.getTable()} SET ${setClause} WHERE id = ?`,
      [...values, id]
    );

    return this.find(id);
  }

  static async delete(id) {
    const adapter = ConnectionManager.getAdapter();
    await adapter.run(`DELETE FROM ${this.getTable()} WHERE id = ?`, [id]);
    return true;
  }
}
