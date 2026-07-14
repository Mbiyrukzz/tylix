/**
 * Fluent query builder returned by Model.query(). Accumulates a
 * structured descriptor and only hits the database when a terminal
 * method (get/first/count) is called.
 */
export class QueryBuilder {
  constructor(ModelClass) {
    this.ModelClass = ModelClass;
    this.wheres = [];
    this.orders = [];
    this.limitValue = undefined;
    this.offsetValue = undefined;
  }

  where(field, operatorOrValue, maybeValue) {
    const hasExplicitOperator = maybeValue !== undefined;
    const operator = hasExplicitOperator ? operatorOrValue : "=";
    const value = hasExplicitOperator ? maybeValue : operatorOrValue;

    this.wheres.push({ field, operator, value });
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
}
