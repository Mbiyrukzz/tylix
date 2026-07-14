import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthGenerator } from "./AuthGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("generates User model, validator, controller, and migration", async () => {
  const outputDir = path.join(__dirname, ".tmp-test-output");
  await fs.mkdir(outputDir, { recursive: true });

  const generator = new AuthGenerator();
  const results = await generator.generate(outputDir);

  const modelContent = await fs.readFile(results.model, "utf-8");
  const validatorContent = await fs.readFile(results.validator, "utf-8");
  const controllerContent = await fs.readFile(results.controller, "utf-8");
  const migrationContent = await fs.readFile(results.migration, "utf-8");

  assert.match(modelContent, /export class User extends Model/);
  assert.match(modelContent, /static async create\(data\)/);
  assert.match(validatorContent, /export function validateRegister/);
  assert.match(validatorContent, /export function validateLogin/);
  assert.match(controllerContent, /export class AuthController/);
  assert.match(controllerContent, /async register\(req, res\)/);
  assert.match(controllerContent, /async login\(req, res\)/);
  assert.match(controllerContent, /async me\(req, res\)/);
  assert.match(migrationContent, /createTable\("users"/);

  await fs.rm(outputDir, { recursive: true, force: true });
});
