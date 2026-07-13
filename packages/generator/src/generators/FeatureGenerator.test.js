import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Blueprint } from "../blueprint/Blueprint.js";
import { FeatureGenerator } from "./FeatureGenerator.js";

test("generates model, migration, controller, and manifest for Post", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Post")
    .field("title", "string")
    .field("slug", "string", { unique: true })
    .field("body", "text")
    .api()
    .crud();

  const generator = new FeatureGenerator();
  const results = await generator.generate(blueprint, tmpDir);

  const modelContent = await fs.readFile(results.model, "utf-8");
  const migrationContent = await fs.readFile(results.migration, "utf-8");
  const controllerContent = await fs.readFile(results.controller, "utf-8");
  const manifestContent = await fs.readFile(results.manifest, "utf-8");
  const manifest = JSON.parse(manifestContent);

  assert.match(modelContent, /export class Post extends Model/);
  assert.match(migrationContent, /createTable\("posts"/);
  assert.match(controllerContent, /export class PostController/);

  assert.equal(manifest.name, "Post");
  assert.equal(manifest.table, "posts");
  assert.equal(manifest.controller, "PostController");
  assert.deepEqual(manifest.permissions, [
    "post.view",
    "post.create",
    "post.update",
    "post.delete",
  ]);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
