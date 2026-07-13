#!/usr/bin/env node
import { makeModel } from "./commands/makeModel.js";
import { makeMigration } from "./commands/makeMigration.js";
import { makeController } from "./commands/makeController.js";
import { makeFeature } from "./commands/makeFeature.js";

const [, , command, subject, ...rest] = process.argv;

const COMMANDS = {
  "make:model": makeModel,
  "make:migration": makeMigration,
  "make:controller": makeController,
  "make:feature": makeFeature,
};

async function main() {
  const handler = COMMANDS[command];

  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error(`Available commands: ${Object.keys(COMMANDS).join(", ")}`);
    process.exit(1);
  }

  if (!subject) {
    console.error(`Usage: tylix ${command} <Name> [field:type ...]`);
    process.exit(1);
  }

  await handler(subject, rest);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
