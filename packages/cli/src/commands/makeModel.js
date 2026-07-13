import path from 'node:path'
import { Blueprint, ModelGenerator } from '@tylix/generator'

export async function makeModel(name, fieldArgs = []) {
  const blueprint = new Blueprint(name)

  for (const arg of fieldArgs) {
    const [fieldName, fieldType = 'string'] = arg.split(':')
    blueprint.field(fieldName, fieldType)
  }

  const generator = new ModelGenerator()
  const outputDir = path.join(process.cwd(), 'app', 'models')
  const outputPath = await generator.generate(blueprint, outputDir)

  console.log(`✔ Model created: ${path.relative(process.cwd(), outputPath)}`)
}
