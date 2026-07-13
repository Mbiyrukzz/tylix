#!/usr/bin/env node
import { makeModel } from "./commands/makeModel.js";
import { makeMigration } from "./commands/makeMigration.js";
import { makeController } from "./commands/makeController.js";
import { makeFeature } from "./commands/makeFeature.js";
import { migrate } from "./commands/migrate.js";

const [, , command, ...rest] = process.argv;

async function main() {
  if (command === "migrate") {
    await migrate();
    return;
  }

  const [subject, ...fieldArgs] = rest;
  const COMMANDS = {
    "make:model": makeModel,
    "make:migration": makeMigration,
    "make:controller": makeController,
    "make:feature": makeFeature,
  };

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error(`Available commands: migrate, ${Object.keys(COMMANDS).join(", ")}`);
    process.exit(1);
  }

  if (!subject) {
    console.error(`Usage: tylix ${command} <Name> [field:type ...]`);
    process.exit(1);
  }

  await handler(subject, fieldArgs);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
