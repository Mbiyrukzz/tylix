import path from 'node:path'
import { Blueprint, MigrationGenerator } from '@tylix/generator'
import { detectLanguage } from '@tylix/shared'

export async function makeMigration(name, fieldArgs = []) {
  const baseDir = process.cwd()
  const blueprint = new Blueprint(name)

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = 'string', modifier] = arg.split(':')
    const options = modifier === 'unique' ? { unique: true } : {}
    blueprint.field(fieldName, fieldType, options)
  }

  const language = await detectLanguage(baseDir)
  const generator = new MigrationGenerator()
  const outputDir = path.join(baseDir, 'database', 'migrations')
  const outputPath = await generator.generate(blueprint, outputDir, language)

  console.log(`✔ Migration created: ${path.relative(baseDir, outputPath)}`)
}
