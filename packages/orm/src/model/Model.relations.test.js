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

class Comment extends Model {
  static table = "comments";
  static fillable = ["content", "post_id"];
}

let tmpDir;
let adapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-relations-test-"));
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

  await adapter.run(`
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      post_id INTEGER,
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

test("belongsTo() loads the parent row via foreign key", async () => {
  const post = await Post.create({ title: "Hello" });
  const comment = await Comment.create({ content: "Nice post!", post_id: post.id });

  const loadedPost = await Comment.belongsTo(comment, "post_id", Post);
  assert.equal(loadedPost.title, "Hello");
});

test("belongsTo() returns null when foreign key is missing", async () => {
  const orphan = { content: "no post", post_id: null };
  const result = await Comment.belongsTo(orphan, "post_id", Post);
  assert.equal(result, null);
});

test("hasMany() loads all child rows for a parent", async () => {
  const post = await Post.create({ title: "Popular Post" });
  await Comment.create({ content: "First!", post_id: post.id });
  await Comment.create({ content: "Second!", post_id: post.id });
  await Comment.create({ content: "Unrelated", post_id: 9999 });

  const comments = await Post.hasMany(post, Comment, "post_id");
  assert.equal(comments.length, 2);
  assert.equal(comments[0].content, "First!");
  assert.equal(comments[1].content, "Second!");
});

test("hasMany() returns an empty array when there are no children", async () => {
  const post = await Post.create({ title: "Lonely Post" });
  const comments = await Post.hasMany(post, Comment, "post_id");
  assert.deepEqual(comments, []);
});
