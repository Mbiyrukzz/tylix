import { execSync } from 'node:child_process'
import path from 'node:path'

export function installPackages(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const cmd = config.packageManager === 'pnpm' ? 'pnpm install' : 'npm install'
  execSync(cmd, { cwd: targetDir, stdio: 'pipe' })
}
