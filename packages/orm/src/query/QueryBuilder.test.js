import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "../adapters/SqliteAdapter.js";
import { ConnectionManager } from "../model/ConnectionManager.js";
import { Model } from "../model/Model.js";

class Post extends Model {
  static table = "posts";
  static fillable = ["title", "views", "status"];
}

let tmpDir;
let adapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-querybuilder-test-"));
  adapter = new SqliteAdapter({ filename: path.join(tmpDir, "test.sqlite") });
  await adapter.connect();
  await adapter.run(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      views INTEGER,
      status TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  ConnectionManager.setAdapter(adapter);

  await Post.create({ title: "Draft Post", views: 10, status: "draft" });
  await Post.create({ title: "Popular Post", views: 500, status: "published" });
  await Post.create({ title: "Medium Post", views: 150, status: "published" });
});

afterEach(async () => {
  await adapter.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
  ConnectionManager.reset();
});

test("Post.query() with where() filters correctly", async () => {
  const results = await Post.query().where("status", "published").get();
  assert.equal(results.length, 2);
});

test("where() with explicit operator", async () => {
  const results = await Post.query().where("views", ">", 100).get();
  assert.equal(results.length, 2);
});

test("orderBy() and limit() chain correctly", async () => {
  const results = await Post.query()
    .where("status", "published")
    .orderBy("views", "DESC")
    .limit(1)
    .get();

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Popular Post");
});

test("first() returns a single row or null", async () => {
  const found = await Post.query().where("status", "draft").first();
  assert.equal(found.title, "Draft Post");

  const notFound = await Post.query().where("status", "archived").first();
  assert.equal(notFound, null);
});

test("count() returns the number of matching rows", async () => {
  const count = await Post.query().where("status", "published").count();
  assert.equal(count, 2);
});

test("query() with no where() returns all rows", async () => {
  const results = await Post.query().get();
  assert.equal(results.length, 3);
});
