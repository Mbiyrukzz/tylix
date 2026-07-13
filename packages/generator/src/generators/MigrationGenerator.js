import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, resolveColumnType } from "@tylix/shared";
import { TemplateEngine } from "../templates/TemplateEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../../templates/migration.tyx");

export class MigrationGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine;
  }

  formatColumns(fields) {
    return fields
      .map((f) => {
        const columnType = resolveColumnType(f.type);
        const modifiers = f.unique ? `.unique()` : "";
        return `        table.${columnType}("${f.name}")${modifiers};`;
      })
      .join("\n");
  }

  timestampedFilename(tableName) {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `${stamp}_create_${tableName}_table.js`;
  }

  async generate(blueprint, outputDir) {
    const template = await fs.readFile(TEMPLATE_PATH, "utf-8");

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      table: blueprint.tableName,
      columns: this.formatColumns(blueprint.fields),
    });

    const filename = this.timestampedFilename(blueprint.tableName);
    const outputPath = path.join(outputDir, filename);
    return writeFile(outputPath, code, { overwrite: true });
  }
}
