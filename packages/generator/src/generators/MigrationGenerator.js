import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, resolveColumnType } from '@tylix/shared'
import { TemplateEngine } from '../templates/TemplateEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '../../templates/migration.tyx')
const TEMPLATE_PATH_TS = path.join(
  __dirname,
  '../../templates/migration-ts.tyx',
)

export class MigrationGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine
  }

  formatColumns(fields) {
    return fields
      .map((f) => {
        const columnType = resolveColumnType(f.type)
        const modifiers = f.unique ? `.unique()` : ''
        return `        table.${columnType}("${f.name}")${modifiers};`
      })
      .join('\n')
  }

  timestampedFilename(tableName, language = 'javascript') {
    const now = new Date()
    const stamp = now
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)
    const ext = language === 'typescript' ? 'ts' : 'js'
    return `${stamp}_create_${tableName}_table.${ext}`
  }

  async generate(blueprint, outputDir, language = 'javascript') {
    const templatePath =
      language === 'typescript' ? TEMPLATE_PATH_TS : TEMPLATE_PATH
    const template = await fs.readFile(templatePath, 'utf-8')

    const code = this.templateEngine.render(template, {
      Model: blueprint.name,
      table: blueprint.tableName,
      columns: this.formatColumns(blueprint.fields),
    })

    const filename = this.timestampedFilename(blueprint.tableName, language)
    const outputPath = path.join(outputDir, filename)
    return writeFile(outputPath, code, { overwrite: true })
  }
}
