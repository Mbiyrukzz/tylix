import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, detectLanguage } from '@tylix/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'templates')

function timestampSuffix(offsetMs = 0) {
  return new Date(Date.now() + offsetMs)
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
}

// The migration that already creates `table`, whatever its timestamp, so
// running make:auth again (for example to regenerate the controller) never
// adds a second "create users table" migration.
async function findExistingMigration(migrationsDir, name) {
  let entries = []
  try {
    entries = await fs.readdir(migrationsDir)
  } catch {
    return null // no migrations folder yet
  }
  const pattern = new RegExp(`^\\d{14}_${name}\\.(js|ts)$`)
  const match = entries.filter((entry) => pattern.test(entry)).sort()[0]
  return match ? path.join(migrationsDir, match) : null
}

export class AuthGenerator {
  async generate(baseDir) {
    const results = {}
    const language = await detectLanguage(baseDir)
    const ext = language === 'typescript' ? 'ts' : 'js'
    const suffix = language === 'typescript' ? '-ts' : ''

    const read = (name) =>
      fs.readFile(path.join(TEMPLATES_DIR, `${name}${suffix}.tyx`), 'utf-8')

    results.userModel = await writeFile(
      path.join(baseDir, 'app', 'models', `User.${ext}`),
      await read('user-model'),
      { overwrite: true },
    )

    results.refreshTokenModel = await writeFile(
      path.join(baseDir, 'app', 'models', `RefreshToken.${ext}`),
      await read('refresh-token-model'),
      { overwrite: true },
    )

    results.passwordResetModel = await writeFile(
      path.join(baseDir, 'app', 'models', `PasswordReset.${ext}`),
      await read('password-reset-model'),
      { overwrite: true },
    )

    results.validator = await writeFile(
      path.join(baseDir, 'app', 'validators', `AuthValidator.${ext}`),
      await read('auth-validator'),
      { overwrite: true },
    )

    results.controller = await writeFile(
      path.join(baseDir, 'app', 'controllers', `AuthController.${ext}`),
      await read('auth-controller'),
      { overwrite: true },
    )

    results.mailer = await writeFile(
      path.join(baseDir, 'app', 'mail', `mailer.${ext}`),
      await read('mailer'),
      { overwrite: true },
    )

    results.verifyEmailMail = await writeFile(
      path.join(baseDir, 'app', 'mail', `VerifyEmailMail.${ext}`),
      await read('verify-email-mail'),
      { overwrite: true },
    )

    results.resetPasswordMail = await writeFile(
      path.join(baseDir, 'app', 'mail', `ResetPasswordMail.${ext}`),
      await read('reset-password-mail'),
      { overwrite: true },
    )

    await fs.mkdir(path.join(baseDir, 'resources', 'mail'), { recursive: true })

    results.verifyEmailView = await writeFile(
      path.join(baseDir, 'resources', 'mail', 'verify-email.html'),
      await fs.readFile(
        path.join(TEMPLATES_DIR, 'verify-email-view.html'),
        'utf-8',
      ),
      { overwrite: true },
    )

    results.resetPasswordView = await writeFile(
      path.join(baseDir, 'resources', 'mail', 'reset-password.html'),
      await fs.readFile(
        path.join(TEMPLATES_DIR, 'reset-password-view.html'),
        'utf-8',
      ),
      { overwrite: true },
    )

    // An existing migration is kept as it is: it may already have run
    // against a database, so rewriting it would be wrong too.
    const migrationsDir = path.join(baseDir, 'database', 'migrations')
    const writeMigration = async (name, offsetMs, template) => {
      const existing = await findExistingMigration(migrationsDir, name)
      if (existing) return existing
      return writeFile(
        path.join(migrationsDir, `${timestampSuffix(offsetMs)}_${name}.${ext}`),
        await read(template),
        { overwrite: true },
      )
    }

    results.userMigration = await writeMigration('create_users_table', 0, 'user-migration')

    results.refreshTokenMigration = await writeMigration('create_refresh_tokens_table', 1000, 'refresh-token-migration')

    results.passwordResetMigration = await writeMigration('create_password_resets_table', 2000, 'password-reset-migration')

    return results
  }
}
