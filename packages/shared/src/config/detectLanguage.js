import path from 'node:path'
import { exists } from '../filesystem/writeFile.js'

// TypeScript when the project has a tsconfig.json or a tylix.config.ts.
export async function detectLanguage(baseDir = process.cwd()) {
  const ts =
    (await exists(path.join(baseDir, 'tsconfig.json'))) || (await exists(path.join(baseDir, 'tylix.config.ts')))
  return ts ? 'typescript' : 'javascript'
}
