import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "@tylix/shared";
import { TemplateEngine } from "../templates/TemplateEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../../templates/controller.tyx");

export class ControllerGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine;
  }

  async generate(blueprint, outputDir) {
    const template = await fs.readFile(TEMPLATE_PATH, "utf-8");

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      modelLower: blueprint.name.charAt(0).toLowerCase() + blueprint.name.slice(1),
    });

    const outputPath = path.join(outputDir, `${blueprint.name}Controller.js`);
    return writeFile(outputPath, code, { overwrite: true });
  }
}
