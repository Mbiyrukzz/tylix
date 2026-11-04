import { execSync } from 'node:child_process'
import path from 'node:path'
import { getPackageManager, execCommand } from '../utils/packageManager.js'

export async function finalize(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const pm = getPackageManager(config)

  if (config.authEnabled && config.installNow) {
    execSync(execCommand(pm, 'tylix make:auth'), {
      cwd: targetDir,
      stdio: 'inherit',
    })
  }
  // if (config.installNow) {
  //   execSync(execCommand(pm, 'tylix migrate'), { cwd: targetDir, stdio: 'inherit' })
  // }
}