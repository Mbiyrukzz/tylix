import fs from 'node:fs/promises'
import path from 'node:path'

export async function writeComponents(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const componentsDir = path.join(targetDir, 'app', 'components')
  await fs.mkdir(componentsDir, { recursive: true })
}
