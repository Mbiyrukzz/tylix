import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresAdapter, toPositionalPlaceholders, ensureReturningId } from "./PostgresAdapter.js";

test("toPositionalPlaceholders converts ? to $1, $2, $3...", () => {
  const sql = "INSERT INTO posts (title, body) VALUES (?, ?)";
  assert.equal(
    toPositionalPlaceholders(sql),
    "INSERT INTO posts (title, body) VALUES ($1, $2)"
  );
});

test("toPositionalPlaceholders handles a single placeholder", () => {
  assert.equal(toPositionalPlaceholders("SELECT * FROM posts WHERE id = ?"), "SELECT * FROM posts WHERE id = $1");
});

test("ensureReturningId appends RETURNING id to bare INSERT statements", () => {
  const sql = "INSERT INTO posts (title) VALUES (?)";
  assert.equal(ensureReturningId(sql), "INSERT INTO posts (title) VALUES (?) RETURNING id");
});

test("ensureReturningId does not duplicate an existing RETURNING clause", () => {
  const sql = "INSERT INTO posts (title) VALUES (?) RETURNING id";
  assert.equal(ensureReturningId(sql), sql);
});

test("ensureReturningId leaves non-INSERT statements untouched", () => {
  const sql = "UPDATE posts SET title = ? WHERE id = ?";
  assert.equal(ensureReturningId(sql), sql);
});

test("columnType maps logical types to Postgres SQL types", () => {
  const adapter = new PostgresAdapter({ database: "test" });
  assert.equal(adapter.columnType("increments"), "SERIAL PRIMARY KEY");
  assert.equal(adapter.columnType("boolean"), "BOOLEAN");
  assert.equal(adapter.columnType("json"), "JSONB");
});

test("columnType throws on unknown logical type", () => {
  const adapter = new PostgresAdapter({ database: "test" });
  assert.throws(() => adapter.columnType("nonsense"), /no mapping/);
});

test("ensureConnected throws before connect() is called", async () => {
  const adapter = new PostgresAdapter({ database: "test" });
  await assert.rejects(() => adapter.all("SELECT 1"));
});
