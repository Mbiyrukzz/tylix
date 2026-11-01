import path from 'node:path'
import { Blueprint, ControllerGenerator } from '@tylix/generator'
import { detectLanguage } from '@tylix/shared'

export async function makeController(name, fieldArgs = []) {
  const baseDir = process.cwd()
  const blueprint = new Blueprint(name)

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = 'string', third] = arg.split(':')

    if (fieldType === 'belongsTo') {
      blueprint.belongsTo(fieldName)
      continue
    }

    if (fieldType === 'hasMany') {
      // syntax: comments:hasMany:Comment  -> third segment is the target model
      blueprint.hasMany(third || fieldName)
      continue
    }

    const options = {}
    if (third === 'unique') options.unique = true
    if (third === 'system') options.system = true
    blueprint.field(fieldName, fieldType, options)
  }

  const language = await detectLanguage(baseDir)
  const generator = new ControllerGenerator()
  const outputDir = path.join(baseDir, 'app', 'controllers')
  const outputPath = await generator.generate(blueprint, outputDir, language)

  console.log(`✔ Controller created: ${path.relative(baseDir, outputPath)}`)
}