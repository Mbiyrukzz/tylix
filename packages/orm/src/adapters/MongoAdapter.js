import { MongoClient } from "mongodb";
import { DatabaseAdapter } from "./DatabaseAdapter.js";

export function parseQuery(sql) {
  const trimmed = sql.trim().replace(/\s+/g, " ");

  let match;

  if ((match = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(trimmed))) {
    return { type: "createTable", table: match[1] };
  }

  if ((match = /^DROP TABLE IF EXISTS (\w+)/i.exec(trimmed))) {
    return { type: "dropTable", table: match[1] };
  }

  if ((match = /^SELECT \* FROM (\w+) WHERE (\w+) = \?$/i.exec(trimmed))) {
    return { type: "findOne", table: match[1], field: match[2] };
  }

  if ((match = /^SELECT \* FROM (\w+)$/i.exec(trimmed))) {
    return { type: "findAll", table: match[1] };
  }

  if ((match = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i.exec(trimmed))) {
    const columns = match[2].split(",").map((c) => c.trim());
    return { type: "insert", table: match[1], columns };
  }

  if ((match = /^UPDATE (\w+) SET (.+) WHERE (\w+) = \?$/i.exec(trimmed))) {
    const setClause = match[2];
    const columns = setClause.split(",").map((pair) => pair.trim().split("=")[0].trim());
    return { type: "update", table: match[1], columns, whereField: match[3] };
  }

  if ((match = /^DELETE FROM (\w+) WHERE (\w+) = \?$/i.exec(trimmed))) {
    return { type: "delete", table: match[1], field: match[2] };
  }

  throw new Error(`MongoAdapter does not recognize this query shape: "${trimmed}"`);
}

export class MongoAdapter extends DatabaseAdapter {
  constructor({ url = "mongodb://localhost:27017", database } = {}) {
    super();
    this.url = url;
    this.dbName = database;
    this.client = null;
    this.db = null;
    this.counters = {};
  }

  async connect() {
    this.client = new MongoClient(this.url);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    return this;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  ensureConnected() {
    if (!this.db) {
      throw new Error("MongoAdapter is not connected. Call connect() first.");
    }
  }

  async nextId(table) {
    const counters = this.db.collection("__tylix_counters");
    const result = await counters.findOneAndUpdate(
      { _id: table },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
    return result.seq;
  }

  async run(sql, params = []) {
    this.ensureConnected();
    const query = parseQuery(sql);

    if (query.type === "createTable") {
      const collections = await this.db.listCollections({ name: query.table }).toArray();
      if (collections.length === 0) {
        await this.db.createCollection(query.table);
      }
      return {};
    }

    if (query.type === "dropTable") {
      const collections = await this.db.listCollections({ name: query.table }).toArray();
      if (collections.length > 0) {
        await this.db.collection(query.table).drop();
      }
      return {};
    }

    if (query.type === "insert") {
      const id = await this.nextId(query.table);
      const doc = { id };
      query.columns.forEach((col, i) => {
        doc[col] = params[i];
      });
      await this.db.collection(query.table).insertOne(doc);
      return { lastInsertRowid: id };
    }

    if (query.type === "update") {
      const whereValue = params[params.length - 1];
      const setValues = params.slice(0, params.length - 1);
      const $set = {};
      query.columns.forEach((col, i) => {
        $set[col] = setValues[i];
      });
      await this.db
        .collection(query.table)
        .updateOne({ [query.whereField]: whereValue }, { $set });
      return {};
    }

    if (query.type === "delete") {
      await this.db.collection(query.table).deleteOne({ [query.field]: params[0] });
      return {};
    }

    throw new Error(`run() cannot handle query type "${query.type}"`);
  }

  async get(sql, params = []) {
    this.ensureConnected();
    const query = parseQuery(sql);

    if (query.type === "findOne") {
      const doc = await this.db
        .collection(query.table)
        .findOne({ [query.field]: params[0] }, { projection: { _id: 0 } });
      return doc ?? null;
    }

    throw new Error(`get() cannot handle query type "${query.type}"`);
  }

  async all(sql, params = []) {
    this.ensureConnected();
    const query = parseQuery(sql);

    if (query.type === "findAll") {
      return this.db.collection(query.table).find({}, { projection: { _id: 0 } }).toArray();
    }

    if (query.type === "findOne") {
      return this.db
        .collection(query.table)
        .find({ [query.field]: params[0] }, { projection: { _id: 0 } })
        .toArray();
    }

    throw new Error(`all() cannot handle query type "${query.type}"`);
  }

  async count(table) {
    this.ensureConnected();
    return this.db.collection(table).countDocuments();
  }

  async paginate(table, limit, offset) {
    this.ensureConnected();
    return this.db
      .collection(table)
      .find({}, { projection: { _id: 0 } })
      .sort({ id: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  columnType() {
    return null;
  }
}

MongoAdapter.prototype.query = async function (table, { wheres = [], orders = [], limitValue, offsetValue } = {}) {
  this.ensureConnected();

  const filter = {};
  for (const w of wheres) {
    if (w.operator === "=") filter[w.field] = w.value;
    else if (w.operator === "!=") filter[w.field] = { $ne: w.value };
    else if (w.operator === ">") filter[w.field] = { $gt: w.value };
    else if (w.operator === "<") filter[w.field] = { $lt: w.value };
    else if (w.operator === ">=") filter[w.field] = { $gte: w.value };
    else if (w.operator === "<=") filter[w.field] = { $lte: w.value };
    else throw new Error(`Unsupported where operator "${w.operator}" for MongoAdapter`);
  }

  let cursor = this.db.collection(table).find(filter, { projection: { _id: 0 } });

  if (orders.length > 0) {
    const sort = {};
    orders.forEach((o) => {
      sort[o.field] = o.direction.toUpperCase() === "DESC" ? -1 : 1;
    });
    cursor = cursor.sort(sort);
  }

  if (offsetValue !== undefined) cursor = cursor.skip(offsetValue);
  if (limitValue !== undefined) cursor = cursor.limit(limitValue);

  return cursor.toArray();
};
