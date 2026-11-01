import { MongoClient } from 'mongodb'
import { DatabaseAdapter } from './DatabaseAdapter.js'
import { normalizeDatabaseError } from './DatabaseError.js'

// Same rule the SQL builder uses: plain identifiers only, with optional
// dots for nested fields. Rejects "$where", "$or", spaces, quotes, etc.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/

// Same cap as the SQL builder, so a query that works on one driver
// doesn't fail on another.
const MAX_LIST_VALUES = 1000

function assertField(name) {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    throw new Error(`Invalid column name "${String(name)}".`)
  }
  return name
}

// Validates the array given to IN / NOT IN, with the same rules as SQL.
function assertList(values, operator) {
  if (!Array.isArray(values)) {
    throw new Error(`Operator "${operator}" needs an array of values.`)
  }
  if (values.length > MAX_LIST_VALUES) {
    throw new Error(
      `Operator "${operator}" accepts at most ${MAX_LIST_VALUES} values, got ${values.length}.`,
    )
  }
  if (values.some((v) => v === null || v === undefined)) {
    throw new Error(
      `"${operator}" lists cannot contain null or undefined. Use whereNull() / whereNotNull() for null checks.`,
    )
  }
  return values
}

// SQL LIKE -> anchored, case-insensitive regex ("%" = any run, "_" = any
// single character). Case-insensitive to match MySQL and SQLite.
function likeToRegex(pattern) {
  if (typeof pattern !== 'string') {
    throw new Error('LIKE needs a string pattern.')
  }
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const source = escaped.replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${source}$`, 'is')
}

export function parseQuery(sql) {
  const trimmed = sql.trim().replace(/\s+/g, ' ')

  let match

  if ((match = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(trimmed))) {
    return { type: 'createTable', table: match[1] }
  }

  if ((match = /^DROP TABLE IF EXISTS (\w+)/i.exec(trimmed))) {
    return { type: 'dropTable', table: match[1] }
  }

  if ((match = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(trimmed))) {
    return { type: 'alterAddColumn', table: match[1], column: match[2] }
  }

  if ((match = /^ALTER TABLE (\w+) DROP COLUMN (\w+)$/i.exec(trimmed))) {
    return { type: 'alterDropColumn', table: match[1], column: match[2] }
  }

  if ((match = /^SELECT \* FROM (\w+) WHERE (\w+) = \?$/i.exec(trimmed))) {
    return { type: 'findOne', table: match[1], field: match[2] }
  }

  if ((match = /^SELECT \* FROM (\w+)$/i.exec(trimmed))) {
    return { type: 'findAll', table: match[1] }
  }

  if (
    (match = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i.exec(
      trimmed,
    ))
  ) {
    const columns = match[2].split(',').map((c) => c.trim())
    return { type: 'insert', table: match[1], columns }
  }

  if ((match = /^UPDATE (\w+) SET (.+) WHERE (\w+) = \?$/i.exec(trimmed))) {
    const setClause = match[2]
    const columns = setClause
      .split(',')
      .map((pair) => pair.trim().split('=')[0].trim())
    return { type: 'update', table: match[1], columns, whereField: match[3] }
  }

  if ((match = /^DELETE FROM (\w+) WHERE (\w+) = \?$/i.exec(trimmed))) {
    return { type: 'delete', table: match[1], field: match[2] }
  }

  throw new Error(
    `MongoAdapter does not recognize this query shape: "${trimmed}"`,
  )
}

export class MongoAdapter extends DatabaseAdapter {
  constructor({ url = 'mongodb://localhost:27017', database } = {}) {
    super()
    this.url = url
    this.dbName = database
    this.client = null
    this.db = null
    this.counters = {}
  }

  async connect() {
    try {
      // Fail after 5s instead of the driver's default 30s, so a stopped
      // MongoDB server shows up quickly.
      this.client = new MongoClient(this.url, { serverSelectionTimeoutMS: 5000 })
      await this.client.connect()
      this.db = this.client.db(this.dbName)
    } catch (err) {
      const error = normalizeDatabaseError('mongodb', err)
      // Never print credentials: mongodb://user:pass@host -> mongodb://***@host
      const safeUrl = String(this.url).replace(/\/\/[^@/]*@/, '//***@')
      error.detail = `Tried ${safeUrl}, database "${this.dbName}"`
      await this.client?.close().catch(() => {})
      this.client = null
      this.db = null
      throw error
    }
    return this
  }

  async close() {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.db = null
    }
  }

  quoteIdentifier(name) {
    return name
  }

  ensureConnected() {
    if (!this.db) {
      throw new Error('MongoAdapter is not connected. Call connect() first.')
    }
  }

  // Wraps any Mongo operation so failures become DatabaseErrors.
  // `sql` is whatever text best describes what was attempted: the
  // SQL-like string for run/get/all, or an equivalent db.x.find(...)
  // description for query/count/paginate.
  async guard(ctx, fn) {
    try {
      return await fn()
    } catch (err) {
      throw normalizeDatabaseError('mongodb', err, ctx)
    }
  }

  async nextId(table) {
    const counters = this.db.collection('__tylix_counters')
    const result = await counters.findOneAndUpdate(
      { _id: table },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    )
    return result.seq
  }

  async run(sql, params = []) {
    this.ensureConnected()
    return this.guard({ sql, params }, () => this._run(sql, params))
  }

  async _run(sql, params) {
    const query = parseQuery(sql)

    if (query.type === 'createTable') {
      const collections = await this.db
        .listCollections({ name: query.table })
        .toArray()
      if (collections.length === 0) {
        await this.db.createCollection(query.table)
      }
      return {}
    }

    if (query.type === 'dropTable') {
      const collections = await this.db
        .listCollections({ name: query.table })
        .toArray()
      if (collections.length > 0) {
        await this.db.collection(query.table).drop()
      }
      return {}
    }

    if (query.type === 'alterAddColumn') {
      return {}
    }

    // Unlike ADD, DROP needs a real write: old documents still carry
    // the removed field's data, and it would keep coming back in
    // find()/query() results (Model.all(), etc.) forever unless
    // explicitly stripped from every existing document.
    if (query.type === 'alterDropColumn') {
      await this.db
        .collection(query.table)
        .updateMany({}, { $unset: { [query.column]: '' } })
      return {}
    }

    if (query.type === 'insert') {
      const id = await this.nextId(query.table)
      const doc = { id }
      query.columns.forEach((col, i) => {
        doc[col] = params[i]
      })
      await this.db.collection(query.table).insertOne(doc)
      return { lastInsertRowid: id }
    }

    if (query.type === 'update') {
      const whereValue = params[params.length - 1]
      const setValues = params.slice(0, params.length - 1)
      const $set = {}
      query.columns.forEach((col, i) => {
        $set[col] = setValues[i]
      })
      await this.db
        .collection(query.table)
        .updateOne({ [query.whereField]: whereValue }, { $set })
      return {}
    }

    if (query.type === 'delete') {
      await this.db
        .collection(query.table)
        .deleteOne({ [query.field]: params[0] })
      return {}
    }

    throw new Error(`run() cannot handle query type "${query.type}"`)
  }

  async get(sql, params = []) {
    this.ensureConnected()
    return this.guard({ sql, params }, async () => {
      const query = parseQuery(sql)

      if (query.type === 'findOne') {
        const doc = await this.db
          .collection(query.table)
          .findOne({ [query.field]: params[0] }, { projection: { _id: 0 } })
        return doc ?? null
      }

      throw new Error(`get() cannot handle query type "${query.type}"`)
    })
  }

  async all(sql, params = []) {
    this.ensureConnected()
    return this.guard({ sql, params }, async () => {
      const query = parseQuery(sql)

      if (query.type === 'findAll') {
        return this.db
          .collection(query.table)
          .find({}, { projection: { _id: 0 } })
          .toArray()
      }

      if (query.type === 'findOne') {
        return this.db
          .collection(query.table)
          .find({ [query.field]: params[0] }, { projection: { _id: 0 } })
          .toArray()
      }

      throw new Error(`all() cannot handle query type "${query.type}"`)
    })
  }

  async count(table) {
    this.ensureConnected()
    return this.guard({ sql: `db.${table}.countDocuments()` }, () =>
      this.db.collection(table).countDocuments(),
    )
  }

  async paginate(table, limit, offset) {
    this.ensureConnected()
    return this.guard(
      {
        sql: `db.${table}.find({}).sort({"id":1}).skip(${offset}).limit(${limit})`,
      },
      () =>
        this.db
          .collection(table)
          .find({}, { projection: { _id: 0 } })
          .sort({ id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
    )
  }

  async listTables() {
    this.ensureConnected()
    return this.guard({ sql: 'db.listCollections()' }, async () => {
      const collections = await this.db.listCollections().toArray()
      return collections.map((c) => c.name)
    })
  }

  async query(table, { wheres = [], orders = [], limitValue, offsetValue } = {}) {
    this.ensureConnected()

    let filter = {}
    const sort = {}
    const description = () => {
      const show = (value) =>
        JSON.stringify(value, (key, v) => (v instanceof RegExp ? String(v) : v))
      let text = `db.${table}.find(${show(filter)})`
      if (Object.keys(sort).length) text += `.sort(${show(sort)})`
      if (offsetValue !== undefined) text += `.skip(${offsetValue})`
      if (limitValue !== undefined) text += `.limit(${limitValue})`
      return text
    }

    return this.guard({ get sql() { return description() } }, async () => {
      // Every condition goes into $and, so several conditions on the same
      // field (age > 18 AND age < 65) all apply, like SQL. Values are
      // always wrapped in an operator, so an object from the client can
      // never be interpreted as a query operator itself.
      const conditions = wheres.map((w) => {
        const field = assertField(w.field)
        const operator = String(w.operator).trim().replace(/\s+/g, ' ').toUpperCase()

        if (operator === '=') return { [field]: { $eq: w.value } }
        if (operator === '!=' || operator === '<>')
          return { [field]: { $ne: w.value } }
        if (operator === '>') return { [field]: { $gt: w.value } }
        if (operator === '<') return { [field]: { $lt: w.value } }
        if (operator === '>=') return { [field]: { $gte: w.value } }
        if (operator === '<=') return { [field]: { $lte: w.value } }
        if (operator === 'LIKE')
          return { [field]: { $regex: likeToRegex(w.value) } }

        // Mongo treats a missing field as null, so IS NULL also matches
        // documents that don't have the field at all.
        if (operator === 'IS NULL') return { [field]: { $eq: null } }
        if (operator === 'IS NOT NULL') return { [field]: { $ne: null } }
        if (operator === 'IN')
          return { [field]: { $in: assertList(w.value, operator) } }
        if (operator === 'NOT IN')
          return { [field]: { $nin: assertList(w.value, operator) } }

        throw new Error(
          `Unsupported where operator "${w.operator}" for MongoAdapter`,
        )
      })

      if (conditions.length > 0) filter = { $and: conditions }

      let cursor = this.db
        .collection(table)
        .find(filter, { projection: { _id: 0 } })

      if (orders.length > 0) {
        orders.forEach((o) => {
          sort[assertField(o.field)] =
            o.direction.toUpperCase() === 'DESC' ? -1 : 1
        })
        cursor = cursor.sort(sort)
      }

      if (offsetValue !== undefined) cursor = cursor.skip(offsetValue)
      if (limitValue !== undefined) cursor = cursor.limit(limitValue)

      return cursor.toArray()
    })
  }

  columnType() {
    return null
  }
}