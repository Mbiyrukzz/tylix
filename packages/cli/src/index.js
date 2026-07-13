#!/usr/bin/env node
import { makeModel } from "./commands/makeModel.js";

const [, , command, subject, ...rest] = process.argv;

async function main() {
  if (command === "make:model") {
    if (!subject) {
      console.error("Usage: tylix make:model <Name> [field:type ...]");
      process.exit(1);
    }
    await makeModel(subject, rest);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Available commands: make:model");
  process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
