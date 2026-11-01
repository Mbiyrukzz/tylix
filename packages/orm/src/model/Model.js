import { ConnectionManager } from './ConnectionManager.js'
import { QueryBuilder } from '../query/QueryBuilder.js'

export class Model {
  static table = null
  static fillable = []
  static timestamps = true

  static getTable() {
    if (!this.table) {
      throw new Error(`${this.name} must define a static "table" property.`)
    }
    return this.table
  }

  static getAdapter() {
    return ConnectionManager.getAdapter()
  }

  static async all() {
    const adapter = ConnectionManager.getAdapter()
    return adapter.all(`SELECT * FROM ${this.getTable()}`)
  }

  /**
   * Returns a QueryBuilder for fluent filtering:
   *   await Post.query().where("status", "published").orderBy("created_at", "DESC").get()
   */
  static query() {
    return new QueryBuilder(this)
  }

  /**
   * Shortcut for query().where(...):
   *   await Post.where("status", "published").get()
   *   await Post.where("views", ">", 100).first()
   *   await Post.where("deleted_at", null).get()      // IS NULL
   */
  static where(...args) {
    return this.query().where(...args)
  }

  /** deleted_at IS NULL. Returns a QueryBuilder: await Post.whereNull("deleted_at").get() */
  static whereNull(field) {
    return this.query().whereNull(field)
  }

  /** verified_at IS NOT NULL. Returns a QueryBuilder. */
  static whereNotNull(field) {
    return this.query().whereNotNull(field)
  }

  /** id IN (1, 2, 3). Returns a QueryBuilder: await Post.whereIn("id", [1, 2]).get() */
  static whereIn(field, values) {
    return this.query().whereIn(field, values)
  }

  /** status NOT IN ("banned", "spam"). Returns a QueryBuilder. */
  static whereNotIn(field, values) {
    return this.query().whereNotIn(field, values)
  }

  /** Newest first. Returns a QueryBuilder: await Post.latest().get() */
  static latest(column = 'created_at') {
    return this.query().latest(column)
  }

  /** Oldest first. Returns a QueryBuilder: await Post.oldest().first() */
  static oldest(column = 'created_at') {
    return this.query().oldest(column)
  }

  static async paginate({ page = 1, limit = 20, where = {} } = {}) {
    const safePage = Math.max(1, Math.floor(page))
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))
    const offset = (safePage - 1) * safeLimit

    let query = this.query()
    for (const [field, value] of Object.entries(where)) {
      query = query.where(field, value)
    }

    const total = await query.count()
    const data = await query.limit(safeLimit).offset(offset).get()

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    }
  }

  static async find(id) {
    const adapter = ConnectionManager.getAdapter()
    return adapter.get(`SELECT * FROM ${this.getTable()} WHERE id = ?`, [id])
  }

  /** Like find(), but throws (with err.status = 404) when the row is missing. */
  static async findOrFail(id) {
    const row = await this.find(id)
    if (!row) {
      const error = new Error(`${this.name} with id ${id} not found.`)
      error.status = 404
      throw error
    }
    return row
  }

  static async create(data) {
    const adapter = ConnectionManager.getAdapter()
    const fields = this.fillable.filter((f) => f in data)

    if (fields.length === 0) {
      throw new Error(`No fillable fields provided for ${this.name}.create()`)
    }

    const values = { ...Object.fromEntries(fields.map((f) => [f, data[f]])) }

    if (this.timestamps) {
      const now = new Date().toISOString()
      values.created_at = now
      values.updated_at = now
    }

    const columns = Object.keys(values)
    const placeholders = columns.map(() => '?').join(', ')
    const columnValues = Object.values(values)

    const result = await adapter.run(
      `INSERT INTO ${this.getTable()} (${columns.join(', ')}) VALUES (${placeholders})`,
      columnValues,
    )

    return this.find(result.lastInsertRowid)
  }

  static async update(id, data) {
    const adapter = ConnectionManager.getAdapter()
    const fields = this.fillable.filter((f) => f in data)

    if (fields.length === 0) {
      throw new Error(`No fillable fields provided for ${this.name}.update()`)
    }

    const values = { ...Object.fromEntries(fields.map((f) => [f, data[f]])) }

    if (this.timestamps) {
      values.updated_at = new Date().toISOString()
    }

    const setClause = Object.keys(values)
      .map((f) => `${f} = ?`)
      .join(', ')
    const columnValues = Object.values(values)

    await adapter.run(
      `UPDATE ${this.getTable()} SET ${setClause} WHERE id = ?`,
      [...columnValues, id],
    )

    return this.find(id)
  }

  static async delete(id) {
    const adapter = ConnectionManager.getAdapter()
    await adapter.run(`DELETE FROM ${this.getTable()} WHERE id = ?`, [id])
    return true
  }

  /**
   * Delete one or more rows by id and return how many actually existed:
   *   await Post.destroy(1)
   *   await Post.destroy(1, 2, 3)
   *   await Post.destroy([1, 2, 3])
   */
  static async destroy(...ids) {
    const flat = ids.flat().filter((id) => id !== undefined && id !== null)
    if (flat.length === 0) {
      throw new Error(`${this.name}.destroy() needs at least one id.`)
    }

    let deleted = 0
    for (const id of flat) {
      if (await this.find(id)) {
        await this.delete(id)
        deleted++
      }
    }
    return deleted
  }

  /**
   * Find the first row matching `attributes`, or create it with
   * `attributes` + `values`:
   *   await User.firstOrCreate({ email: "a@b.com" }, { name: "Ann" })
   */
  static async firstOrCreate(attributes, values = {}) {
    const keys = Object.keys(attributes ?? {})
    if (keys.length === 0) {
      throw new Error(
        `${this.name}.firstOrCreate() needs at least one attribute to match on.`,
      )
    }

    let query = this.query()
    for (const key of keys) {
      query = query.where(key, attributes[key])
    }

    const existing = await query.first()
    if (existing) return existing

    return this.create({ ...attributes, ...values })
  }

  /**
   * Find the first row matching `attributes` and update it with `values`,
   * or create it with `attributes` + `values`:
   *   await Setting.updateOrCreate({ key: "theme" }, { value: "dark" })
   */
  static async updateOrCreate(attributes, values = {}) {
    const keys = Object.keys(attributes ?? {})
    if (keys.length === 0) {
      throw new Error(
        `${this.name}.updateOrCreate() needs at least one attribute to match on.`,
      )
    }

    let query = this.query()
    for (const key of keys) {
      query = query.where(key, attributes[key])
    }

    const existing = await query.first()
    if (!existing) {
      return this.create({ ...attributes, ...values })
    }

    const hasFillableChange = this.fillable.some((f) => f in values)
    if (!hasFillableChange) return existing

    return this.update(existing.id, values)
  }

  /**
   * One column as a plain array (or an object when a key column is given):
   *   await User.pluck("email")           -> ["a@b.com", "c@d.com"]
   *   await User.pluck("email", "id")     -> { 1: "a@b.com", 2: "c@d.com" }
   */
  static async pluck(column, keyColumn) {
    return this.query().pluck(column, keyColumn)
  }

  /** True when the table has at least one row. */
  static async exists() {
    return this.query().exists()
  }

  static async belongsTo(row, foreignKey, RelatedModel) {
    if (!row || row[foreignKey] === undefined || row[foreignKey] === null) {
      return null
    }
    return RelatedModel.find(row[foreignKey])
  }

  static async hasMany(row, RelatedModel, foreignKey) {
    const adapter = ConnectionManager.getAdapter()
    return adapter.all(
      `SELECT * FROM ${RelatedModel.getTable()} WHERE ${foreignKey} = ?`,
      [row.id],
    )
  }

  static async first() {
    return this.query().first()
  }

  static async count() {
    return this.query().count()
  }
}