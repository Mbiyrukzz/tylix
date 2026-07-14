import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Blueprint } from "../blueprint/Blueprint.js";
import { ControllerGenerator } from "./ControllerGenerator.js";

test("generates a PostController with CRUD methods and validation calls", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Post").field("title", "string");

  const generator = new ControllerGenerator();
  const outputPath = await generator.generate(blueprint, tmpDir);

  const content = await fs.readFile(outputPath, "utf-8");

  assert.match(path.basename(outputPath), /^PostController\.js$/);
  assert.match(content, /import \{ Post \} from "\.\.\/models\/Post\.js";/);
  assert.match(content, /import \{ validatePost \} from "\.\.\/validators\/PostValidator\.js";/);
  assert.match(content, /export class PostController/);
  assert.match(content, /async index\(req, res\)/);
  assert.match(content, /const posts = await Post\.all\(\);/);
  assert.match(content, /async show\(req, res\)/);
  assert.match(content, /async store\(req, res\)/);
  assert.match(content, /const result = validatePost\(req\.body\)/);
  assert.match(content, /res\.status\(422\)\.json\(\{ errors: result\.errors \}\)/);
  assert.match(content, /async update\(req, res\)/);
  assert.match(content, /async destroy\(req, res\)/);
  assert.doesNotMatch(content, /req\.query\.include/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("generates a CommentController that supports ?include=post", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Comment")
    .field("content", "text")
    .belongsTo("Post");

  const generator = new ControllerGenerator();
  const outputPath = await generator.generate(blueprint, tmpDir);

  const content = await fs.readFile(outputPath, "utf-8");

  assert.match(content, /if \(req\.query\.include === "post"\)/);
  assert.match(content, /comment\.post = await Comment\.post\(comment\);/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("generates a PostController that supports ?include=comments", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Post")
    .field("title", "string")
    .hasMany("Comment");

  const generator = new ControllerGenerator();
  const outputPath = await generator.generate(blueprint, tmpDir);

  const content = await fs.readFile(outputPath, "utf-8");

  assert.match(content, /if \(req\.query\.include === "comments"\)/);
  assert.match(content, /post\.comments = await Post\.comments\(post\);/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
