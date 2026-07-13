import path from "node:path";
import { Blueprint, MigrationGenerator } from "@tylix/generator";

export async function makeMigration(name, fieldArgs = []) {
  const blueprint = new Blueprint(name);

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = "string", modifier] = arg.split(":");
    const options = modifier === "unique" ? { unique: true } : {};
    blueprint.field(fieldName, fieldType, options);
  }

  const generator = new MigrationGenerator();
  const outputDir = path.join(process.cwd(), "database", "migrations");
  const outputPath = await generator.generate(blueprint, outputDir);

  console.log(`✔ Migration created: ${path.relative(process.cwd(), outputPath)}`);
}
