import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, resolveFieldRuleNames } from '@tylix/shared'
import { TemplateEngine } from '../templates/TemplateEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '../../templates/validator.tyx')
const TEMPLATE_PATH_TS = path.join(
  __dirname,
  '../../templates/validator-ts.tyx',
)

export class ValidatorGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine
  }

  buildRuleMap(fields) {
    const ruleNames = new Set()
    const fieldRules = fields
      .filter((field) => !field.system)
      .map((field) => {
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

  async generate(blueprint, outputDir, language = 'javascript') {
    const templatePath =
      language === 'typescript' ? TEMPLATE_PATH_TS : TEMPLATE_PATH
    const template = await fs.readFile(templatePath, 'utf-8')
    const { ruleNames, fieldRules } = this.buildRuleMap(blueprint.fields)

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      ruleImports: [...ruleNames].join(', '),
      schemaEntries: this.formatSchemaEntries(fieldRules),
    })

    const ext = language === 'typescript' ? 'ts' : 'js'
    const outputPath = path.join(outputDir, `${blueprint.name}Validator.${ext}`)
    return writeFile(outputPath, code, { overwrite: true })
  }
}
