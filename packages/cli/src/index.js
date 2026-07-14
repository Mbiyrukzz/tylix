#!/usr/bin/env node
import { makeModel } from "./commands/makeModel.js";
import { makeMigration } from "./commands/makeMigration.js";
import { makeController } from "./commands/makeController.js";
import { makeFeature } from "./commands/makeFeature.js";
import { makeAuth } from "./commands/makeAuth.js";
import { migrate } from "./commands/migrate.js";
import { dev } from "./commands/dev.js";

const [, , command, ...rest] = process.argv;

async function main() {
  if (command === "migrate") {
    await migrate();
    return;
  }

  if (command === "dev") {
    const portArg = rest.find((a) => a.startsWith("--port="));
    const port = portArg ? Number(portArg.split("=")[1]) : 3000;
    await dev({ port });
    return;
  }

  if (command === "make:auth") {
    await makeAuth();
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
    console.error(`Available commands: dev, migrate, make:auth, ${Object.keys(COMMANDS).join(", ")}`);
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
