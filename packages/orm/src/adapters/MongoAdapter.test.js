import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, MongoAdapter } from "./MongoAdapter.js";

test("recognizes SELECT * FROM table", () => {
  assert.deepEqual(parseQuery("SELECT * FROM posts"), { type: "findAll", table: "posts" });
});

test("recognizes SELECT * FROM table WHERE field = ?", () => {
  assert.deepEqual(parseQuery("SELECT * FROM posts WHERE id = ?"), {
    type: "findOne",
    table: "posts",
    field: "id",
  });
});

test("recognizes INSERT INTO table (cols) VALUES (?...)", () => {
  const result = parseQuery("INSERT INTO posts (title, body) VALUES (?, ?)");
  assert.equal(result.type, "insert");
  assert.equal(result.table, "posts");
  assert.deepEqual(result.columns, ["title", "body"]);
});

test("recognizes UPDATE table SET col=?,col=? WHERE field = ?", () => {
  const result = parseQuery("UPDATE posts SET title = ?, body = ? WHERE id = ?");
  assert.equal(result.type, "update");
  assert.deepEqual(result.columns, ["title", "body"]);
  assert.equal(result.whereField, "id");
});

test("recognizes DELETE FROM table WHERE field = ?", () => {
  assert.deepEqual(parseQuery("DELETE FROM posts WHERE id = ?"), {
    type: "delete",
    table: "posts",
    field: "id",
  });
});

test("recognizes CREATE TABLE IF NOT EXISTS as a no-op shape", () => {
  const result = parseQuery("CREATE TABLE IF NOT EXISTS posts (id INT)");
  assert.equal(result.type, "createTable");
  assert.equal(result.table, "posts");
});

test("throws clearly on an unrecognized query shape", () => {
  assert.throws(() => parseQuery("SELECT COUNT(*) FROM posts"), /does not recognize/);
});

test("ensureConnected throws before connect() is called", async () => {
  const adapter = new MongoAdapter({ database: "test" });
  await assert.rejects(() => adapter.all("SELECT * FROM posts"));
});
