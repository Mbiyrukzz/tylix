/**
 * Fluent query builder returned by Model.query(). Accumulates a
 * structured descriptor and only hits the database when a terminal
 * method (get/first/count/pluck/exists) is called.
 */
export class QueryBuilder {
  constructor(ModelClass) {
    this.ModelClass = ModelClass;
    this.wheres = [];
    this.orders = [];
    this.limitValue = undefined;
    this.offsetValue = undefined;
  }

  // where("status", "active")        status = 'active'
  // where("age", ">", 18)            age > 18
  // where("deleted_at", null)        deleted_at IS NULL
  // where("id", "IN", [1, 2, 3])     same as whereIn("id", [1, 2, 3])
  where(field, operatorOrValue, maybeValue) {
    const hasExplicitOperator = maybeValue !== undefined;
    const operator = hasExplicitOperator ? operatorOrValue : "=";
    const value = hasExplicitOperator ? maybeValue : operatorOrValue;

    this.wheres.push({ field, operator, value });
    return this;
  }

  // deleted_at IS NULL
  whereNull(field) {
    this.wheres.push({ field, operator: "IS NULL", value: null });
    return this;
  }

  // deleted_at IS NOT NULL
  whereNotNull(field) {
    this.wheres.push({ field, operator: "IS NOT NULL", value: null });
    return this;
  }

  // id IN (1, 2, 3). An empty array matches nothing.
  whereIn(field, values) {
    if (!Array.isArray(values)) {
      throw new Error("whereIn() needs an array of values.");
    }
    this.wheres.push({ field, operator: "IN", value: [...values] });
    return this;
  }

  // id NOT IN (1, 2, 3). An empty array excludes nothing.
  whereNotIn(field, values) {
    if (!Array.isArray(values)) {
      throw new Error("whereNotIn() needs an array of values.");
    }
    this.wheres.push({ field, operator: "NOT IN", value: [...values] });
    return this;
  }

  orderBy(field, direction = "ASC") {
    const normalized = direction.toUpperCase();
    if (normalized !== "ASC" && normalized !== "DESC") {
      throw new Error(`orderBy direction must be "ASC" or "DESC", got "${direction}"`);
    }
    this.orders.push({ field, direction: normalized });
    return this;
  }

  // Newest first (by created_at unless another column is given).
  latest(column = "created_at") {
    return this.orderBy(column, "DESC");
  }

  // Oldest first (by created_at unless another column is given).
  oldest(column = "created_at") {
    return this.orderBy(column, "ASC");
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  offset(value) {
    this.offsetValue = value;
    return this;
  }

  toDescriptor() {
    return {
      wheres: this.wheres,
      orders: this.orders,
      limitValue: this.limitValue,
      offsetValue: this.offsetValue,
    };
  }

  async get() {
    const adapter = this.ModelClass.getAdapter();
    return adapter.query(this.ModelClass.getTable(), this.toDescriptor());
  }

  async first() {
    const results = await this.limit(1).get();
    return results[0] ?? null;
  }

  async count() {
    const rows = await this.get();
    return rows.length;
  }

  // pluck("email")        -> ["a@b.com", ...]
  // pluck("email", "id")  -> { 1: "a@b.com", ... }
  async pluck(column, keyColumn) {
    const rows = await this.get();
    if (keyColumn === undefined) {
      return rows.map((row) => row[column]);
    }
    return Object.fromEntries(rows.map((row) => [row[keyColumn], row[column]]));
  }

  async exists() {
    const row = await this.first();
    return row !== null;
  }
}