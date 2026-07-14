import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "../adapters/SqliteAdapter.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { Model } from "./Model.js";

class Post extends Model {
  static table = "posts";
  static fillable = ["title"];
}

let tmpDir;
let adapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-paginate-test-"));
  adapter = new SqliteAdapter({ filename: path.join(tmpDir, "test.sqlite") });
  await adapter.connect();
  await adapter.run(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  ConnectionManager.setAdapter(adapter);

  for (let i = 1; i <= 25; i++) {
    await Post.create({ title: `Post ${i}` });
  }
});

afterEach(async () => {
  await adapter.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
  ConnectionManager.reset();
});

test("paginate() defaults to page 1, limit 20", async () => {
  const result = await Post.paginate();
  assert.equal(result.data.length, 20);
  assert.equal(result.data[0].title, "Post 1");
  assert.equal(result.meta.page, 1);
  assert.equal(result.meta.limit, 20);
  assert.equal(result.meta.total, 25);
  assert.equal(result.meta.totalPages, 2);
});

test("paginate() returns the second page correctly", async () => {
  const result = await Post.paginate({ page: 2, limit: 20 });
  assert.equal(result.data.length, 5);
  assert.equal(result.data[0].title, "Post 21");
});

test("paginate() respects a custom limit", async () => {
  const result = await Post.paginate({ page: 1, limit: 10 });
  assert.equal(result.data.length, 10);
  assert.equal(result.meta.totalPages, 3);
});

test("paginate() clamps limit to a maximum of 100", async () => {
  const result = await Post.paginate({ page: 1, limit: 9999 });
  assert.equal(result.meta.limit, 100);
});

test("paginate() clamps page to a minimum of 1", async () => {
  const result = await Post.paginate({ page: -5, limit: 20 });
  assert.equal(result.meta.page, 1);
  assert.equal(result.data[0].title, "Post 1");
});
