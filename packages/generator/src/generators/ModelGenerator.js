import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "@tylix/shared";
import { TemplateEngine } from "../templates/TemplateEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../../templates/model.tyx");

export class ModelGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine;
  }

  formatFillable(fields) {
    return fields
      .map((f) => `        "${f.name}",`)
      .join("\n");
  }

  async generate(blueprint, outputDir) {
    const template = await fs.readFile(TEMPLATE_PATH, "utf-8");

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      table: blueprint.tableName,
      fillable: this.formatFillable(blueprint.fields),
    });

    const outputPath = path.join(outputDir, `${blueprint.name}.js`);
    return writeFile(outputPath, code, { overwrite: true });
  }
}
