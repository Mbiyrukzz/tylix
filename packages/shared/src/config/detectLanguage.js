import fs from 'node:fs/promises'
import path from 'node:path'

export async function detectLanguage(baseDir = process.cwd()) {
  const exists = await fs
    .access(path.join(baseDir, 'tsconfig.json'))
    .then(() => true)
    .catch(() => false)
  return exists ? 'typescript' : 'javascript'
}
