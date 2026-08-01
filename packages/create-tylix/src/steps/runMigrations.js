import { execSync } from 'node:child_process'
import path from 'node:path'
import { password } from '../utils/prompt.js'
import { yellow, red } from '@tylix/shared'
import { writeDatabaseConfig } from './writeDatabaseConfig.js'
import { updateEnvPassword } from './updateEnvPassword.js'

const MAX_ATTEMPTS = 3

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

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      execSync('npx tylix migrate', { cwd: targetDir, stdio: 'pipe' })
      return
    } catch (err) {
      const stderr = err.stderr?.toString() ?? ''

      if (!isAuthError(stderr)) {
        throw err
      }

      if (attempt === MAX_ATTEMPTS) {
        console.log(
          red(`\n✖ Database authentication failed ${MAX_ATTEMPTS} times.\n`) +
            `Your project was still created, but migrations were skipped.\n` +
            `Fix DATABASE_PASSWORD in ${path.join(config.projectName, '.env')} and run:\n` +
            `  cd ${config.projectName} && npx tylix migrate\n`,
        )
        return
      }

      console.log(
        yellow(
          `\n✖ Database authentication failed. Let's try that password again.\n`,
        ),
      )

      config.databasePassword = await password({
        message:
          config.database === 'postgres'
            ? 'Enter the password you set for your local PostgreSQL "postgres" user'
            : 'Enter the password you set for your local MySQL "root" user',
      })

      await updateEnvPassword(targetDir, config.databasePassword)
      await writeDatabaseConfig(config)
    }
  }
}
