import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "@tylix/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");

export class AuthGenerator {
  async generate(baseDir) {
    const results = {};

    const modelTemplate = await fs.readFile(path.join(TEMPLATES_DIR, "user-model.tyx"), "utf-8");
    results.model = await writeFile(
      path.join(baseDir, "app", "models", "User.js"),
      modelTemplate,
      { overwrite: true }
    );

    const validatorTemplate = await fs.readFile(
      path.join(TEMPLATES_DIR, "auth-validator.tyx"),
      "utf-8"
    );
    results.validator = await writeFile(
      path.join(baseDir, "app", "validators", "AuthValidator.js"),
      validatorTemplate,
      { overwrite: true }
    );

    const controllerTemplate = await fs.readFile(
      path.join(TEMPLATES_DIR, "auth-controller.tyx"),
      "utf-8"
    );
    results.controller = await writeFile(
      path.join(baseDir, "app", "controllers", "AuthController.js"),
      controllerTemplate,
      { overwrite: true }
    );

    const migrationTemplate = await fs.readFile(
      path.join(TEMPLATES_DIR, "user-migration.tyx"),
      "utf-8"
    );
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    results.migration = await writeFile(
      path.join(baseDir, "database", "migrations", `${timestamp}_create_users_table.js`),
      migrationTemplate,
      { overwrite: true }
    );

    return results;
  }
}
