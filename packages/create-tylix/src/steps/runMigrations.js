import { execSync } from 'node:child_process'
import path from 'node:path'

export function runMigrations(config) {
  if (config.database === 'none') return
  const targetDir = path.join(process.cwd(), config.projectName)
  execSync('npx tylix migrate', { cwd: targetDir, stdio: 'pipe' })
}
