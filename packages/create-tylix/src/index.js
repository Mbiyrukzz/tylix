#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path from this package to the tylix monorepo root, used to build
// file: dependencies while @tylix/* packages aren't published to npm yet.
const MONOREPO_ROOT = path.resolve(__dirname, "../../..");

async function scaffold(projectName) {
  const targetDir = path.join(process.cwd(), projectName);

  const exists = await fs.access(targetDir).then(() => true).catch(() => false);
  if (exists) {
    console.error(`Directory "${projectName}" already exists.`);
    process.exit(1);
  }

  console.log(`\nCreating a new Tylix app in ${targetDir}\n`);

  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(path.join(targetDir, "app", "models"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "app", "controllers"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "app", "Features"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "database", "migrations"), { recursive: true });

  const packageJson = {
    name: projectName,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "tylix dev",
      migrate: "tylix migrate",
    },
    dependencies: {
      "@tylix/cli": `file:${path.join(MONOREPO_ROOT, "packages", "cli")}`,
      "@tylix/auth": `file:${path.join(MONOREPO_ROOT, "packages", "auth")}`,
      "@tylix/compiler": `file:${path.join(MONOREPO_ROOT, "packages", "compiler")}`,
      "@tylix/core": `file:${path.join(MONOREPO_ROOT, "packages", "core")}`,
      "@tylix/generator": `file:${path.join(MONOREPO_ROOT, "packages", "generator")}`,
      "@tylix/orm": `file:${path.join(MONOREPO_ROOT, "packages", "orm")}`,
      "@tylix/shared": `file:${path.join(MONOREPO_ROOT, "packages", "shared")}`,
    },
  };

  await fs.writeFile(
    path.join(targetDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  const configTemplate = await fs.readFile(
    path.join(__dirname, "templates", "tylix.config.js.template"),
    "utf-8"
  );
  await fs.writeFile(path.join(targetDir, "tylix.config.js"), configTemplate);

  const gitignoreTemplate = await fs.readFile(
    path.join(__dirname, "templates", "gitignore.template"),
    "utf-8"
  );
  await fs.writeFile(path.join(targetDir, ".gitignore"), gitignoreTemplate);

  console.log("Installing dependencies (this links local @tylix packages)...\n");
  execSync("npm install", { cwd: targetDir, stdio: "inherit" });

  console.log(`\n✔ Project created!\n`);
  console.log(`Next steps:\n`);
  console.log(`  cd ${projectName}`);
  console.log(`  npx tylix make:feature Post title:string body:text`);
  console.log(`  npx tylix migrate`);
  console.log(`  npx tylix dev\n`);
}

const projectName = process.argv[2];

if (!projectName) {
  console.error("Usage: create-tylix <project-name>");
  process.exit(1);
}

scaffold(projectName).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
