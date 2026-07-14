import { MongoClient } from "mongodb";
import { DatabaseAdapter } from "./DatabaseAdapter.js";

/**
 * MongoAdapter does NOT implement a general SQL engine. Tylix only ever
 * generates a small, fixed set of query shapes (from Model.js and the
 * migration runner). This function recognizes those exact shapes and
 * returns a structured description; anything else throws clearly rather
 * than silently doing the wrong thing.
 */
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
    // Mongo has no auto-increment; Tylix simulates integer ids with a
    // per-collection counter so generated code (which expects numeric
    // ids like SQL databases return) keeps working unchanged.
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
      // Used by hasMany: "SELECT * FROM comments WHERE post_id = ?"
      return this.db
        .collection(query.table)
        .find({ [query.field]: params[0] }, { projection: { _id: 0 } })
        .toArray();
    }

    throw new Error(`all() cannot handle query type "${query.type}"`);
  }

  columnType() {
    // Mongo is schemaless; migrations become no-ops via createTable(),
    // so this is never actually consulted, but must exist to satisfy
    // the DatabaseAdapter interface.
    return null;
  }
}
