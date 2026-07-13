import fs from "node:fs/promises";
import path from "node:path";
import { Blueprint, FeatureGenerator } from "@tylix/generator";

async function ensurePackageJson(baseDir) {
  const pkgPath = path.join(baseDir, "package.json");
  const exists = await fs.access(pkgPath).then(() => true).catch(() => false);
  if (!exists) {
    await fs.writeFile(
      pkgPath,
      JSON.stringify({ name: "tylix-app", version: "0.1.0", type: "module" }, null, 2)
    );
  }
}

export async function makeFeature(name, fieldArgs = []) {
  const blueprint = new Blueprint(name);

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = "string", modifier] = arg.split(":");
    const options = modifier === "unique" ? { unique: true } : {};
    blueprint.field(fieldName, fieldType, options);
  }

  blueprint.timestamps().api().crud();

  const baseDir = process.cwd();
  await ensurePackageJson(baseDir);

  const generator = new FeatureGenerator();
  const results = await generator.generate(blueprint, baseDir);

  console.log(`\n✔ Feature "${blueprint.name}" created:\n`);
  console.log(`  Model:      ${path.relative(baseDir, results.model)}`);
  console.log(`  Migration:  ${path.relative(baseDir, results.migration)}`);
  console.log(`  Controller: ${path.relative(baseDir, results.controller)}`);
  console.log(`  Manifest:   ${path.relative(baseDir, results.manifest)}`);
  console.log();
}
