import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./SqliteAdapter.js";

let tmpDir;
let adapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-query-test-"));
  adapter = new SqliteAdapter({ filename: path.join(tmpDir, "test.sqlite") });
  await adapter.connect();
  await adapter.run(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      views INTEGER,
      status TEXT
    )
  `);
  await adapter.run("INSERT INTO posts (title, views, status) VALUES (?, ?, ?)", ["A", 50, "draft"]);
  await adapter.run("INSERT INTO posts (title, views, status) VALUES (?, ?, ?)", ["B", 150, "published"]);
  await adapter.run("INSERT INTO posts (title, views, status) VALUES (?, ?, ?)", ["C", 300, "published"]);
});

afterEach(async () => {
  await adapter.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("query() with a where filter", async () => {
  const rows = await adapter.query("posts", {
    wheres: [{ field: "status", operator: "=", value: "published" }],
  });
  assert.equal(rows.length, 2);
});

test("query() with where + orderBy + limit combined", async () => {
  const rows = await adapter.query("posts", {
    wheres: [{ field: "status", operator: "=", value: "published" }],
    orders: [{ field: "views", direction: "DESC" }],
    limitValue: 1,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "C");
});

test("query() with a > comparison operator", async () => {
  const rows = await adapter.query("posts", {
    wheres: [{ field: "views", operator: ">", value: 100 }],
  });
  assert.equal(rows.length, 2);
});

test("query() with no descriptor returns all rows", async () => {
  const rows = await adapter.query("posts", {});
  assert.equal(rows.length, 3);
});
