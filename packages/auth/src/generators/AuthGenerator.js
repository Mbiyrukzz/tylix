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

    results.userMigration = await writeFile(
      path.join(
        baseDir,
        'database',
        'migrations',
        `${timestampSuffix(0)}_create_users_table.${ext}`,
      ),
      await read('user-migration'),
      { overwrite: true },
    )

    results.refreshTokenMigration = await writeFile(
      path.join(
        baseDir,
        'database',
        'migrations',
        `${timestampSuffix(1000)}_create_refresh_tokens_table.${ext}`,
      ),
      await read('refresh-token-migration'),
      { overwrite: true },
    )

    results.passwordResetMigration = await writeFile(
      path.join(
        baseDir,
        'database',
        'migrations',
        `${timestampSuffix(2000)}_create_password_resets_table.${ext}`,
      ),
      await read('password-reset-migration'),
      { overwrite: true },
    )

    return results
  }
}
