import path from 'node:path'
import { writeFile, detectLanguage } from '@tylix/shared'
import { ModelGenerator } from './ModelGenerator.js'
import { MigrationGenerator } from './MigrationGenerator.js'
import { ControllerGenerator } from './ControllerGenerator.js'
import { ValidatorGenerator } from './ValidatorGenerator.js'
import { ApiHelperGenerator } from './ApiHelperGenerator.js'

export class FeatureGenerator {
  constructor({
    modelGenerator = new ModelGenerator(),
    migrationGenerator = new MigrationGenerator(),
    controllerGenerator = new ControllerGenerator(),
    validatorGenerator = new ValidatorGenerator(),
    apiHelperGenerator = new ApiHelperGenerator(),
  } = {}) {
    this.modelGenerator = modelGenerator
    this.migrationGenerator = migrationGenerator
    this.controllerGenerator = controllerGenerator
    this.validatorGenerator = validatorGenerator
    this.apiHelperGenerator = apiHelperGenerator
  }

  async generate(blueprint, baseDir) {
    const results = {}
    const language = await detectLanguage(baseDir)

    results.model = await this.modelGenerator.generate(
      blueprint,
      path.join(baseDir, 'app', 'models'),
      language,
    )

    results.migration = await this.migrationGenerator.generate(
      blueprint,
      path.join(baseDir, 'database', 'migrations'),
      language,
    )

    results.validator = await this.validatorGenerator.generate(
      blueprint,
      path.join(baseDir, 'app', 'validators'),
      language,
    )

    results.controller = await this.controllerGenerator.generate(
      blueprint,
      path.join(baseDir, 'app', 'controllers'),
      language,
    )

    const apiHelperResults = await this.apiHelperGenerator.generate(
      blueprint,
      path.join(baseDir, 'app', 'useApi', blueprint.name.toLowerCase()),
      language,
    )

    results.apiHelper = apiHelperResults.flat
    results.apiHelperResource = apiHelperResults.resource

    results.manifest = await this.writeManifest(blueprint, baseDir, language)

    return results
  }

  async writeManifest(blueprint, baseDir, language) {
    const ext = language === 'typescript' ? 'ts' : 'js'

    const manifest = {
      name: blueprint.name,
      version: '1.0.0',
      table: blueprint.tableName,
      model: blueprint.name,
      controller: `${blueprint.name}Controller`,
      validator: `${blueprint.name}Validator`,
      language,
      fields: blueprint.fields,
      relations: blueprint.relations,
      auth: Boolean(blueprint.options.auth),
      permissions: [
        `${blueprint.name.toLowerCase()}.view`,
        `${blueprint.name.toLowerCase()}.create`,
        `${blueprint.name.toLowerCase()}.update`,
        `${blueprint.name.toLowerCase()}.delete`,
      ],
    }

    const outputPath = path.join(
      baseDir,
      'app',
      'Features',
      blueprint.name,
      'feature.json',
    )
    await writeFile(outputPath, JSON.stringify(manifest, null, 2), {
      overwrite: true,
    })
    return outputPath
  }
}
