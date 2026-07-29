import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, pluralize } from '@tylix/shared'
import { TemplateEngine } from '../templates/TemplateEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '../../templates/model.tyx')
const TEMPLATE_PATH_TS = path.join(__dirname, '../../templates/model-ts.tyx')

// module-level constant — NOT inside the class body
const TS_FIELD_TYPES = {
  string: 'string',
  text: 'string',
  boolean: 'boolean',
  integer: 'number',
  number: 'number',
  email: 'string',
  date: 'string',
  datetime: 'string',
  json: 'unknown',
}

export class ModelGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine
  }

  formatFillable(fields) {
    return fields.map((f) => `        "${f.name}",`).join('\n')
  }

  formatFieldInterface(fields) {
    return fields
      .map((f) => `    ${f.name}: ${TS_FIELD_TYPES[f.type] ?? 'unknown'};`)
      .join('\n')
  }

  formatRelationMethods(relations = [], language = 'javascript') {
    if (relations.length === 0) return ''
    const isTs = language === 'typescript'
    const rowParam = isTs ? 'row: Record<string, unknown>' : 'row'

    const methods = relations
      .map((rel) => {
        const relatedLower =
          rel.model.charAt(0).toLowerCase() + rel.model.slice(1)

        if (rel.type === 'belongsTo') {
          const returnType = isTs
            ? `: Promise<InstanceType<typeof ${rel.model}> | null>`
            : ''
          return `
    static async ${relatedLower}(${rowParam})${returnType} {
        const { ${rel.model} } = await import("./${rel.model}.js");
        return this.belongsTo(row, "${rel.foreignKey}", ${rel.model});
    }`
        }

        if (rel.type === 'hasMany') {
          const methodName = pluralize(relatedLower)
          const returnType = isTs
            ? `: Promise<InstanceType<typeof ${rel.model}>[]>`
            : ''
          return `
    static async ${methodName}(${rowParam})${returnType} {
        const { ${rel.model} } = await import("./${rel.model}.js");
        return this.hasMany(row, ${rel.model}, "${rel.foreignKey}");
    }`
        }

        return ''
      })
      .join('\n')

    return `\n${methods}\n`
  }

  async generate(blueprint, outputDir, language = 'javascript') {
    const templatePath =
      language === 'typescript' ? TEMPLATE_PATH_TS : TEMPLATE_PATH
    const template = await fs.readFile(templatePath, 'utf-8')

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      table: blueprint.tableName,
      fillable: this.formatFillable(blueprint.fields),
      fieldInterface: this.formatFieldInterface(blueprint.fields),
      relationMethods: this.formatRelationMethods(
        blueprint.relations,
        language,
      ),
    })

    const ext = language === 'typescript' ? 'ts' : 'js'
    const outputPath = path.join(outputDir, `${blueprint.name}.${ext}`)
    return writeFile(outputPath, code, { overwrite: true })
  }
}
