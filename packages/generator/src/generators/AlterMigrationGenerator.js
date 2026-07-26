import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, resolveColumnType } from '@tylix/shared'
import { TemplateEngine } from '../templates/TemplateEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ADD_TEMPLATE_PATH = path.join(
  __dirname,
  '../../templates/alter-add-migration.tyx',
)
const REMOVE_TEMPLATE_PATH = path.join(
  __dirname,
  '../../templates/alter-remove-migration.tyx',
)

export class AlterMigrationGenerator {
  constructor(templateEngine = new TemplateEngine()) {
    this.templateEngine = templateEngine
  }

  formatAddColumns(fields) {
    return fields
      .map((f) => {
        const columnType = resolveColumnType(f.type)
        const modifiers = f.unique ? `.unique()` : ''
        return `        table.${columnType}("${f.name}")${modifiers};`
      })
      .join('\n')
  }

  formatDropColumns(fieldNames) {
    return fieldNames
      .map((name) => `        table.dropColumn("${name}");`)
      .join('\n')
  }

  timestampedFilename(action, table, fieldNames) {
    const now = new Date()
    const stamp = now
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)
    const suffix = fieldNames.join('_')
    const preposition = action === 'add' ? 'to' : 'from'
    return `${stamp}_${action}_${suffix}_${preposition}_${table}_table.js`
  }

  async generateAdd(blueprint, outputDir) {
    const template = await fs.readFile(ADD_TEMPLATE_PATH, 'utf-8')
    const fieldNames = blueprint.fields.map((f) => f.name)

    const code = this.templateEngine.render(template, {
      table: blueprint.tableName,
      addColumns: this.formatAddColumns(blueprint.fields),
      dropColumns: this.formatDropColumns(fieldNames),
    })

    const filename = this.timestampedFilename(
      'add',
      blueprint.tableName,
      fieldNames,
    )
    return writeFile(path.join(outputDir, filename), code, { overwrite: true })
  }

  // fieldDescriptors: [{ name, type, unique }] -- needed so down() can
  // re-add the exact same columns, reversing a "remove" migration.
  async generateRemove(tableName, fieldDescriptors, outputDir) {
    const template = await fs.readFile(REMOVE_TEMPLATE_PATH, 'utf-8')
    const fieldNames = fieldDescriptors.map((f) => f.name)

    const code = this.templateEngine.render(template, {
      table: tableName,
      dropColumns: this.formatDropColumns(fieldNames),
      addColumns: this.formatAddColumns(fieldDescriptors),
    })

    const filename = this.timestampedFilename('remove', tableName, fieldNames)
    return writeFile(path.join(outputDir, filename), code, { overwrite: true })
  }
}
