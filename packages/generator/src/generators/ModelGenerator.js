import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, pluralize } from "@tylix/shared";
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

  formatRelationMethods(relations = []) {
    if (relations.length === 0) return "";

    const methods = relations
      .map((rel) => {
        if (rel.type === "belongsTo") {
          const methodName = rel.model.charAt(0).toLowerCase() + rel.model.slice(1);
          return `
    static async ${methodName}(row) {
        const { ${rel.model} } = await import("./${rel.model}.js");
        return this.belongsTo(row, "${rel.foreignKey}", ${rel.model});
    }`;
        }

        if (rel.type === "hasMany") {
          const relatedLower = rel.model.charAt(0).toLowerCase() + rel.model.slice(1);
          const methodName = pluralize(relatedLower);
          return `
    static async ${methodName}(row) {
        const { ${rel.model} } = await import("./${rel.model}.js");
        return this.hasMany(row, ${rel.model}, "${rel.foreignKey}");
    }`;
        }

        return "";
      })
      .join("\n");

    return `\n${methods}\n`;
  }

  async generate(blueprint, outputDir) {
    const template = await fs.readFile(TEMPLATE_PATH, "utf-8");

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      table: blueprint.tableName,
      fillable: this.formatFillable(blueprint.fields),
      relationMethods: this.formatRelationMethods(blueprint.relations),
    });

    const outputPath = path.join(outputDir, `${blueprint.name}.js`);
    return writeFile(outputPath, code, { overwrite: true });
  }
}
