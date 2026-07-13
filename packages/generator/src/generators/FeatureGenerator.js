import path from "node:path";
import { writeFile } from "@tylix/shared";
import { ModelGenerator } from "./ModelGenerator.js";
import { MigrationGenerator } from "./MigrationGenerator.js";
import { ControllerGenerator } from "./ControllerGenerator.js";

export class FeatureGenerator {
  constructor({
    modelGenerator = new ModelGenerator(),
    migrationGenerator = new MigrationGenerator(),
    controllerGenerator = new ControllerGenerator(),
  } = {}) {
    this.modelGenerator = modelGenerator;
    this.migrationGenerator = migrationGenerator;
    this.controllerGenerator = controllerGenerator;
  }

  async generate(blueprint, baseDir) {
    const results = {};

    results.model = await this.modelGenerator.generate(
      blueprint,
      path.join(baseDir, "app", "models")
    );

    results.migration = await this.migrationGenerator.generate(
      blueprint,
      path.join(baseDir, "database", "migrations")
    );

    results.controller = await this.controllerGenerator.generate(
      blueprint,
      path.join(baseDir, "app", "controllers")
    );

    results.manifest = await this.writeManifest(blueprint, baseDir);

    return results;
  }

  async writeManifest(blueprint, baseDir) {
    const manifest = {
      name: blueprint.name,
      version: "1.0.0",
      table: blueprint.tableName,
      model: blueprint.name,
      controller: `${blueprint.name}Controller`,
      fields: blueprint.fields,
      permissions: [
        `${blueprint.name.toLowerCase()}.view`,
        `${blueprint.name.toLowerCase()}.create`,
        `${blueprint.name.toLowerCase()}.update`,
        `${blueprint.name.toLowerCase()}.delete`,
      ],
    };

    const outputPath = path.join(baseDir, "app", "Features", blueprint.name, "feature.json");
    await writeFile(outputPath, JSON.stringify(manifest, null, 2), { overwrite: true });
    return outputPath;
  }
}
