import fs from 'node:fs/promises'
import path from 'node:path'

export async function writeApiRoutes(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  await fs.mkdir(path.join(targetDir, 'app', 'routes'), { recursive: true })
  // Feature-based API routes (/api/:table CRUD) are generated per-feature
  // by `tylix make:feature`, not at scaffold time — nothing to write here
  // for a fresh project with zero features yet.
}
