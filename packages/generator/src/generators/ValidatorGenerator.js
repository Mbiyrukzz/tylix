import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, resolveFieldRuleNames } from '@tylix/shared'
import { TemplateEngine } from '../templates/TemplateEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '../../templates/validator.tyx')

export class ValidatorGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine
  }

  buildRuleMap(fields) {
    const ruleNames = new Set()
    const fieldRules = fields.map((field) => {
      const names = resolveFieldRuleNames(field)
      names.forEach((n) => ruleNames.add(n))
      return { name: field.name, rules: names }
    })
    return { ruleNames, fieldRules }
  }

  formatSchemaEntries(fieldRules) {
    return fieldRules
      .map((f) => `    ${f.name}: [${f.rules.join(', ')}],`)
      .join('\n')
  }

  async generate(blueprint, outputDir) {
    const template = await fs.readFile(TEMPLATE_PATH, 'utf-8')
    const { ruleNames, fieldRules } = this.buildRuleMap(blueprint.fields)

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      ruleImports: [...ruleNames].join(', '),
      schemaEntries: this.formatSchemaEntries(fieldRules),
    })

    const outputPath = path.join(outputDir, `${blueprint.name}Validator.js`)
    return writeFile(outputPath, code, { overwrite: true })
  }
}
