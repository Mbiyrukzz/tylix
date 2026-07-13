import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Blueprint } from "../blueprint/Blueprint.js";
import { MigrationGenerator } from "./MigrationGenerator.js";

test("generates a migration file for Post with correct columns", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Post")
    .field("title", "string")
    .field("slug", "string", { unique: true })
    .field("body", "text")
    .field("published", "boolean");

  const generator = new MigrationGenerator();
  const outputPath = await generator.generate(blueprint, tmpDir);

  const content = await fs.readFile(outputPath, "utf-8");

  assert.match(path.basename(outputPath), /_create_posts_table\.js$/);
  assert.match(content, /createTable\("posts"/);
  assert.match(content, /table\.string\("title"\);/);
  assert.match(content, /table\.string\("slug"\)\.unique\(\);/);
  assert.match(content, /table\.text\("body"\);/);
  assert.match(content, /table\.boolean\("published"\);/);
  assert.match(content, /table\.timestamps\(\);/);
  assert.match(content, /dropTable\("posts"\)/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
