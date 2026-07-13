import path from "node:path";
import { Blueprint, ControllerGenerator } from "@tylix/generator";

export async function makeController(name, fieldArgs = []) {
  const blueprint = new Blueprint(name);

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = "string", modifier] = arg.split(":");
    const options = modifier === "unique" ? { unique: true } : {};
    blueprint.field(fieldName, fieldType, options);
  }

  const generator = new ControllerGenerator();
  const outputDir = path.join(process.cwd(), "app", "controllers");
  const outputPath = await generator.generate(blueprint, outputDir);

  console.log(`✔ Controller created: ${path.relative(process.cwd(), outputPath)}`);
}
