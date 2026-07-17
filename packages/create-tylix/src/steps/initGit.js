import { execSync } from 'node:child_process'
import path from 'node:path'

export function initGit(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  execSync('git init -q', { cwd: targetDir, stdio: 'pipe' })
  execSync('git add -A', { cwd: targetDir, stdio: 'pipe' })
  execSync('git commit -q -m "Initial commit from create-tylix"', {
    cwd: targetDir,
    stdio: 'pipe',
  })
}
