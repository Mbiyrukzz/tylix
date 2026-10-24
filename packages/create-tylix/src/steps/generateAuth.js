import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export function generateAuth(config) {
  const targetDir = path.join(process.cwd(), config.projectName)

  // Run the CLI entry with the current Node instead of `npx tylix`.
  // `npx` falls back to the registry when the bin is missing, and
  // there is no package called "tylix" there (hence the E404). It also
  // works the same on Windows, where .bin/tylix is a .cmd shim.
  const cliEntry = path.join(
    targetDir,
    'node_modules',
    '@tylix',
    'cli',
    'src',
    'index.js',
  )

  if (!existsSync(cliEntry)) {
    throw new Error(
      'Dependencies are not installed, so authentication could not be generated. ' +
        `Run "cd ${config.projectName} && npm install && npx tylix make:auth".`,
    )
  }

  try {
    execFileSync(process.execPath, [cliEntry, 'make:auth'], {
      cwd: targetDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    })
  } catch (err) {
    // Surface the CLI's own output, not just "Command failed".
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    throw new Error(`make:auth failed${output ? `:\n${output}` : ''}`)
  }
}