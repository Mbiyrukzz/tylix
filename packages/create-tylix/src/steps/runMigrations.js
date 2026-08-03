import { execSync } from 'node:child_process'
import path from 'node:path'

const AUTH_ERROR_PATTERNS = [
  /password authentication failed/i, // postgres
  /Access denied for user/i, // mysql
]

function isAuthError(stderr) {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(stderr))
}

export async function runMigrations(config) {
  if (config.database === 'none') return
  const targetDir = path.join(process.cwd(), config.projectName)

  try {
    execSync('npx tylix migrate', { cwd: targetDir, stdio: 'pipe' })
  } catch (err) {
    const stderr = err.stderr?.toString() ?? ''

    // Don't print or prompt here -- this step runs underneath the
    // progress bar, which redraws by moving the cursor up a fixed
    // number of lines each render(). Any console.log or interactive
    // prompt fired from inside a step desyncs that math and corrupts
    // the bar's display for the rest of the run. Instead, throw a
    // plain error and let scaffold.js's optional-step handling show
    // one clean warning after the bar reaches 100%.
    if (isAuthError(stderr)) {
      throw new Error('Database authentication failed')
    }
    throw err
  }
}
