import { execSync } from 'node:child_process'
import path from 'node:path'

export function generateAuth(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  execSync('npx tylix make:auth', { cwd: targetDir, stdio: 'pipe' })
}
