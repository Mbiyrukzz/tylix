import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, pluralize } from "@tylix/shared";
import { TemplateEngine } from "../templates/TemplateEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../../templates/controller.tyx");

export class ControllerGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine;
  }

  formatIncludeBlock(Model, modelLower, relations = []) {
    if (relations.length === 0) return "";

    const branches = relations
      .map((rel) => {
        if (rel.type === "belongsTo") {
          const relationName = rel.model.charAt(0).toLowerCase() + rel.model.slice(1);
          return `        if (req.query.include === "${relationName}") {
            ${modelLower}.${relationName} = await ${Model}.${relationName}(${modelLower});
        }`;
        }

        if (rel.type === "hasMany") {
          const relatedLower = rel.model.charAt(0).toLowerCase() + rel.model.slice(1);
          const relationName = pluralize(relatedLower);
          return `        if (req.query.include === "${relationName}") {
            ${modelLower}.${relationName} = await ${Model}.${relationName}(${modelLower});
        }`;
        }

        return "";
      })
      .join("\n");

    return `\n${branches}\n`;
  }

  async generate(blueprint, outputDir) {
    const template = await fs.readFile(TEMPLATE_PATH, "utf-8");

    const modelLower = blueprint.name.charAt(0).toLowerCase() + blueprint.name.slice(1);

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      modelLower,
      includeBlock: this.formatIncludeBlock(blueprint.name, modelLower, blueprint.relations),
    });

    const outputPath = path.join(outputDir, `${blueprint.name}Controller.js`);
    return writeFile(outputPath, code, { overwrite: true });
  }
}
