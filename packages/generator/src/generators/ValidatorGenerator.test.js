import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Blueprint } from "../blueprint/Blueprint.js";
import { ValidatorGenerator } from "./ValidatorGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("generates a working PostValidator that validates real data", async () => {
  // Written inside packages/generator so @tylix/shared resolves via the
  // workspace's own node_modules (unlike a /tmp dir with no node_modules).
  const outputDir = path.join(__dirname, ".tmp-test-output");
  await fs.mkdir(outputDir, { recursive: true });

  const blueprint = new Blueprint("Post")
    .field("title", "string")
    .field("email", "email", { required: false })
    .field("published", "boolean");

  const generator = new ValidatorGenerator();
  const outputPath = await generator.generate(blueprint, outputDir);

  const content = await fs.readFile(outputPath, "utf-8");
  assert.match(content, /export function validatePost/);
  assert.match(content, /title: \[required, isString\]/);
  assert.match(content, /published: \[required, isBoolean\]/);

  const { validatePost } = await import(pathToFileURL(outputPath).href);

  const validResult = validatePost({ title: "Hello", published: true });
  assert.equal(validResult.valid, true);

  const invalidResult = validatePost({ published: "not-a-boolean" });
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.errors.title);
  assert.ok(invalidResult.errors.published);

  await fs.rm(outputDir, { recursive: true, force: true });
});
