import fs from 'node:fs/promises'
import path from 'node:path'

export async function writeMiddleware(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  await fs.mkdir(path.join(targetDir, 'app', 'middleware'), { recursive: true })
}
