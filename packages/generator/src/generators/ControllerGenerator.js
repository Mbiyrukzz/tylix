import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, pluralize } from '@tylix/shared'
import { TemplateEngine } from '../templates/TemplateEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '../../templates/controller.tyx')
const TEMPLATE_PATH_TS = path.join(
  __dirname,
  '../../templates/controller-ts.tyx',
)

export class ControllerGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine
  }

  formatIncludeBlock(Model, modelLower, relations = []) {
    if (relations.length === 0) return ''

    const branches = relations
      .map((rel) => {
        if (rel.type === 'belongsTo') {
          const relationName =
            rel.model.charAt(0).toLowerCase() + rel.model.slice(1)
          return `        if (req.query.include === "${relationName}") {
            ${modelLower}.${relationName} = await ${Model}.${relationName}(${modelLower});
        }`
        }

        if (rel.type === 'hasMany') {
          const relatedLower =
            rel.model.charAt(0).toLowerCase() + rel.model.slice(1)
          const relationName = pluralize(relatedLower)
          return `        if (req.query.include === "${relationName}") {
            ${modelLower}.${relationName} = await ${Model}.${relationName}(${modelLower});
        }`
        }

        return ''
      })
      .join('\n')

    return `\n${branches}\n`
  }

  async generate(blueprint, outputDir, language = 'javascript') {
    const templatePath =
      language === 'typescript' ? TEMPLATE_PATH_TS : TEMPLATE_PATH
    const template = await fs.readFile(templatePath, 'utf-8')

    const modelLower =
      blueprint.name.charAt(0).toLowerCase() + blueprint.name.slice(1)

    const filterableFields = blueprint.relations
      .filter((r) => r.type === 'belongsTo')
      .map((r) => r.foreignKey)

    const creatableFields = blueprint.fields
      .filter((f) => !f.system)
      .map((f) => f.name)

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      modelLower,
      includeBlock: this.formatIncludeBlock(
        blueprint.name,
        modelLower,
        blueprint.relations,
      ),
      filterableFields: JSON.stringify(filterableFields),
      creatableFields: JSON.stringify(creatableFields),
    })

    const ext = language === 'typescript' ? 'ts' : 'js'
    const outputPath = path.join(
      outputDir,
      `${blueprint.name}Controller.${ext}`,
    )
    return writeFile(outputPath, code, { overwrite: true })
  }
}
