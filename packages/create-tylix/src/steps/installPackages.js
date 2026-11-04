import { execSync } from 'node:child_process'
import path from 'node:path'
import { getPackageManager, installCommand } from '../utils/packageManager.js'

export function installPackages(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const pm = getPackageManager(config)
  const cmd = installCommand(pm)

  try {
    execSync(cmd, { cwd: targetDir, stdio: 'pipe' })
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`

    // pnpm 10+ refuses to run dependency install scripts that are not
    // allowed in pnpm-workspace.yaml. Say what to do instead of showing
    // pnpm's raw output.
    if (output.includes('ERR_PNPM_IGNORED_BUILDS')) {
      throw new Error(
        `pnpm blocked a dependency's install script (ERR_PNPM_IGNORED_BUILDS).\n` +
          `Run "cd ${config.projectName} && pnpm approve-builds", then "pnpm install".\n\n` +
          output,
      )
    }

    throw err
  }
}