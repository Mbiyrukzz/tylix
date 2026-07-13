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
  static fillable = ["title", "body"];
}

let tmpDir;
let adapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-model-test-"));
  adapter = new SqliteAdapter({ filename: path.join(tmpDir, "test.sqlite") });
  await adapter.connect();
  await adapter.run(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  ConnectionManager.setAdapter(adapter);
});

afterEach(async () => {
  await adapter.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
  ConnectionManager.reset();
});

test("create() inserts a row and returns it", async () => {
  const post = await Post.create({ title: "Hello Tylix", body: "First post" });
  assert.equal(post.title, "Hello Tylix");
  assert.equal(post.body, "First post");
  assert.ok(post.id);
});

test("create() populates created_at and updated_at", async () => {
  const post = await Post.create({ title: "Timestamped", body: "..." });
  assert.ok(post.created_at, "created_at should be set");
  assert.ok(post.updated_at, "updated_at should be set");
  assert.ok(!Number.isNaN(Date.parse(post.created_at)), "created_at should be a valid date string");
});

test("all() returns every row", async () => {
  await Post.create({ title: "One", body: "..." });
  await Post.create({ title: "Two", body: "..." });
  const posts = await Post.all();
  assert.equal(posts.length, 2);
});

test("find() returns a single row by id", async () => {
  const created = await Post.create({ title: "Findable", body: "..." });
  const found = await Post.find(created.id);
  assert.equal(found.title, "Findable");
});

test("update() modifies a row and returns the updated version", async () => {
  const created = await Post.create({ title: "Original", body: "..." });
  const updated = await Post.update(created.id, { title: "Updated" });
  assert.equal(updated.title, "Updated");
});

test("update() bumps updated_at without changing created_at", async () => {
  const created = await Post.create({ title: "Original", body: "..." });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const updated = await Post.update(created.id, { title: "Changed" });

  assert.equal(updated.created_at, created.created_at);
  assert.notEqual(updated.updated_at, created.updated_at);
});

test("delete() removes a row", async () => {
  const created = await Post.create({ title: "ToDelete", body: "..." });
  await Post.delete(created.id);
  const found = await Post.find(created.id);
  assert.equal(found, null);
});

test("create() throws if no fillable fields are provided", async () => {
  await assert.rejects(() => Post.create({ nonExistentField: "x" }));
});
