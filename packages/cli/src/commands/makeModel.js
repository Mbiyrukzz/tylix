import path from 'node:path'
import { Blueprint, ModelGenerator } from '@tylix/generator'
import { detectLanguage } from '@tylix/shared'

export async function makeModel(name, fieldArgs = []) {
  const baseDir = process.cwd()
  const blueprint = new Blueprint(name)

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = 'string'] = arg.split(':')
    blueprint.field(fieldName, fieldType)
  }

  const language = await detectLanguage(baseDir)
  const generator = new ModelGenerator()
  const outputDir = path.join(baseDir, 'app', 'models')
  const outputPath = await generator.generate(blueprint, outputDir, language)

  console.log(`✔ Model created: ${path.relative(baseDir, outputPath)}`)
}
