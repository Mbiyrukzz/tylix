import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getPackageManager, installCommand, execCommand } from '../utils/packageManager.js'

// `tylix make:pwa` in the new project: icons, offline page, the pwa config
// and the install/update prompt. Runs the installed CLI with this Node,
// like generateAuth.
export function generatePwa(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const pm = getPackageManager(config)
  const cliEntry = path.join(targetDir, 'node_modules', '@tylix', 'cli', 'src', 'index.js')
  if (!existsSync(cliEntry)) {
    throw new Error(
      `Dependencies are not installed, so the PWA was not set up. Run "cd ${config.projectName} && ${installCommand(pm)} && ${execCommand(pm, 'tylix make:pwa')}".`,
    )
  }
  try {
    execFileSync(process.execPath, [cliEntry, 'make:pwa'], { cwd: targetDir, stdio: 'pipe', encoding: 'utf-8' })
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    throw new Error(`make:pwa failed${output ? `:\n${output}` : ''}`)
  }
}
