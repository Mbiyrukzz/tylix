import { execSync } from 'node:child_process'
import path from 'node:path'

export async function finalize(config) {
  const targetDir = path.join(process.cwd(), config.projectName)

  if (config.authEnabled && config.installNow) {
    execSync('npx tylix make:auth', { cwd: targetDir, stdio: 'inherit' })
  }
  if (config.installNow) {
    execSync('npx tylix migrate', { cwd: targetDir, stdio: 'inherit' })
  }
}
