import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Blueprint, FeatureGenerator } from "@tylix/generator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_PACKAGES = path.resolve(__dirname, "../../..");

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

async function ensureTylixPackagesLinked(baseDir) {
  const nodeModulesTylix = path.join(baseDir, "node_modules", "@tylix");
  await fs.mkdir(nodeModulesTylix, { recursive: true });

  const neededPackages = ["shared", "orm", "auth", "compiler"];

  for (const pkg of neededPackages) {
    const linkPath = path.join(nodeModulesTylix, pkg);
    const alreadyLinked = await fs.access(linkPath).then(() => true).catch(() => false);
    if (alreadyLinked) continue;

    const sourcePath = path.join(MONOREPO_PACKAGES, pkg);
    await fs.symlink(sourcePath, linkPath, "dir");
  }
}

export async function makeFeature(name, fieldArgs = []) {
  const blueprint = new Blueprint(name);

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = "string", third] = arg.split(":");

    if (fieldType === "belongsTo") {
      blueprint.belongsTo(fieldName);
      continue;
    }

    if (fieldType === "hasMany") {
      // syntax: comments:hasMany:Comment  -> third segment is the target model
      blueprint.hasMany(third || fieldName);
      continue;
    }

    const options = third === "unique" ? { unique: true } : {};
    blueprint.field(fieldName, fieldType, options);
  }

  blueprint.timestamps().api().crud();

  const baseDir = process.cwd();
  await ensurePackageJson(baseDir);
  await ensureTylixPackagesLinked(baseDir);

  const generator = new FeatureGenerator();
  const results = await generator.generate(blueprint, baseDir);

  console.log(`\n✔ Feature "${blueprint.name}" created:\n`);
  console.log(`  Model:      ${path.relative(baseDir, results.model)}`);
  console.log(`  Migration:  ${path.relative(baseDir, results.migration)}`);
  console.log(`  Validator:  ${path.relative(baseDir, results.validator)}`);
  console.log(`  Controller: ${path.relative(baseDir, results.controller)}`);
  console.log(`  Manifest:   ${path.relative(baseDir, results.manifest)}`);
  console.log();
}
