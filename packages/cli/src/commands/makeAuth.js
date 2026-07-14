import path from "node:path";
import { AuthGenerator } from "@tylix/auth";

export async function makeAuth() {
  const baseDir = process.cwd();
  const generator = new AuthGenerator();
  const results = await generator.generate(baseDir);

  console.log(`\n✔ Auth scaffolding created:\n`);
  console.log(`  Model:      ${path.relative(baseDir, results.model)}`);
  console.log(`  Validator:  ${path.relative(baseDir, results.validator)}`);
  console.log(`  Controller: ${path.relative(baseDir, results.controller)}`);
  console.log(`  Migration:  ${path.relative(baseDir, results.migration)}`);
  console.log(`\nRun "tylix migrate" then "tylix dev" to get /api/register, /api/login, /api/me.\n`);
}
