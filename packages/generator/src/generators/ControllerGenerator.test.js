import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Blueprint } from "../blueprint/Blueprint.js";
import { ControllerGenerator } from "./ControllerGenerator.js";

test("generates a PostController with CRUD methods", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-test-"));

  const blueprint = new Blueprint("Post").field("title", "string");

  const generator = new ControllerGenerator();
  const outputPath = await generator.generate(blueprint, tmpDir);

  const content = await fs.readFile(outputPath, "utf-8");

  assert.match(path.basename(outputPath), /^PostController\.js$/);
  assert.match(content, /import \{ Post \} from "\.\.\/models\/Post\.js";/);
  assert.match(content, /export class PostController/);
  assert.match(content, /async index\(req, res\)/);
  assert.match(content, /const posts = await Post\.all\(\);/);
  assert.match(content, /async show\(req, res\)/);
  assert.match(content, /async store\(req, res\)/);
  assert.match(content, /async update\(req, res\)/);
  assert.match(content, /async destroy\(req, res\)/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
