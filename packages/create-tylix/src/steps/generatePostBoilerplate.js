import path from 'node:path'
import { PostBoilerplateGenerator } from '@tylix/generator'

export async function generatePostBoilerplate(config) {
  const baseDir = path.join(process.cwd(), config.projectName)
  const generator = new PostBoilerplateGenerator()
  return generator.generate(baseDir)
}
