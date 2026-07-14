import { ConnectionManager } from "./ConnectionManager.js";
import { QueryBuilder } from "../query/QueryBuilder.js";

export class Model {
  static table = null;
  static fillable = [];
  static timestamps = true;

  static getTable() {
    if (!this.table) {
      throw new Error(`${this.name} must define a static "table" property.`);
    }
    return this.table;
  }

  static getAdapter() {
    return ConnectionManager.getAdapter();
  }

  static async all() {
    const adapter = ConnectionManager.getAdapter();
    return adapter.all(`SELECT * FROM ${this.getTable()}`);
  }

  /**
   * Returns a QueryBuilder for fluent filtering:
   *   await Post.query().where("status", "published").orderBy("created_at", "DESC").get()
   */
  static query() {
    return new QueryBuilder(this);
  }

  static async paginate({ page = 1, limit = 20 } = {}) {
    const adapter = ConnectionManager.getAdapter();
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const offset = (safePage - 1) * safeLimit;

    const total = await adapter.count(this.getTable());
    const data = await adapter.paginate(this.getTable(), safeLimit, offset);

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
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

    const values = { ...Object.fromEntries(fields.map((f) => [f, data[f]])) };

    if (this.timestamps) {
      const now = new Date().toISOString();
      values.created_at = now;
      values.updated_at = now;
    }

    const columns = Object.keys(values);
    const placeholders = columns.map(() => "?").join(", ");
    const columnValues = Object.values(values);

    const result = await adapter.run(
      `INSERT INTO ${this.getTable()} (${columns.join(", ")}) VALUES (${placeholders})`,
      columnValues
    );

    return this.find(result.lastInsertRowid);
  }

  static async update(id, data) {
    const adapter = ConnectionManager.getAdapter();
    const fields = this.fillable.filter((f) => f in data);

    if (fields.length === 0) {
      throw new Error(`No fillable fields provided for ${this.name}.update()`);
    }

    const values = { ...Object.fromEntries(fields.map((f) => [f, data[f]])) };

    if (this.timestamps) {
      values.updated_at = new Date().toISOString();
    }

    const setClause = Object.keys(values)
      .map((f) => `${f} = ?`)
      .join(", ");
    const columnValues = Object.values(values);

    await adapter.run(
      `UPDATE ${this.getTable()} SET ${setClause} WHERE id = ?`,
      [...columnValues, id]
    );

    return this.find(id);
  }

  static async delete(id) {
    const adapter = ConnectionManager.getAdapter();
    await adapter.run(`DELETE FROM ${this.getTable()} WHERE id = ?`, [id]);
    return true;
  }

  static async belongsTo(row, foreignKey, RelatedModel) {
    if (!row || row[foreignKey] === undefined || row[foreignKey] === null) {
      return null;
    }
    return RelatedModel.find(row[foreignKey]);
  }

  static async hasMany(row, RelatedModel, foreignKey) {
    const adapter = ConnectionManager.getAdapter();
    return adapter.all(
      `SELECT * FROM ${RelatedModel.getTable()} WHERE ${foreignKey} = ?`,
      [row.id]
    );
  }
}
