import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Blueprint } from "../blueprint/Blueprint.js";
import { ModelGenerator } from "./ModelGenerator.js";

test("generates a Post model file with correct table and fillable fields", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Post")
    .field("title", "string")
    .field("body", "text")
    .field("published", "boolean");

  const generator = new ModelGenerator();
  const outputPath = await generator.generate(blueprint, tmpDir);

  const content = await fs.readFile(outputPath, "utf-8");

  assert.match(content, /export class Post extends Model/);
  assert.match(content, /static table = "posts";/);
  assert.match(content, /"title",/);
  assert.match(content, /"body",/);
  assert.match(content, /"published",/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("generates a belongsTo relation method for Comment -> Post", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Comment")
    .field("content", "text")
    .belongsTo("Post");

  const generator = new ModelGenerator();
  const outputPath = await generator.generate(blueprint, tmpDir);

  const content = await fs.readFile(outputPath, "utf-8");

  assert.match(content, /export class Comment extends Model/);
  assert.match(content, /static async post\(row\)/);
  assert.match(content, /return this\.belongsTo\(row, "post_id", Post\);/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
