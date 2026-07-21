import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from '@tylix/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'templates')

// Small offsets so migration filenames sort in dependency-safe order
// (users -> refresh_tokens -> password_resets) even when generated
// within the same millisecond.
function timestampSuffix(offsetMs = 0) {
  return new Date(Date.now() + offsetMs)
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
}

// NOTE: this no longer writes a per-project requireAuth middleware file.
// requireAuth already exists in the http runtime package
// (app/../http/requireAuth.js equivalent) and was updated to also accept
// the access-token cookie, so there's nothing feature-specific to
// generate here anymore -- see ROUTES_TO_WIRE_IN.md.
export class AuthGenerator {
  async generate(baseDir) {
    const results = {}
    const read = (name) => fs.readFile(path.join(TEMPLATES_DIR, name), 'utf-8')

    results.userModel = await writeFile(
      path.join(baseDir, 'app', 'models', 'User.js'),
      await read('user-model.tyx'),
      { overwrite: true },
    )

    results.refreshTokenModel = await writeFile(
      path.join(baseDir, 'app', 'models', 'RefreshToken.js'),
      await read('refresh-token-model.tyx'),
      { overwrite: true },
    )

    results.passwordResetModel = await writeFile(
      path.join(baseDir, 'app', 'models', 'PasswordReset.js'),
      await read('password-reset-model.tyx'),
      { overwrite: true },
    )

    results.validator = await writeFile(
      path.join(baseDir, 'app', 'validators', 'AuthValidator.js'),
      await read('auth-validator.tyx'),
      { overwrite: true },
    )

    results.controller = await writeFile(
      path.join(baseDir, 'app', 'controllers', 'AuthController.js'),
      await read('auth-controller.tyx'),
      { overwrite: true },
    )

    results.mailer = await writeFile(
      path.join(baseDir, 'app', 'mail', 'mailer.js'),
      await read('mailer.tyx'),
      { overwrite: true },
    )

    results.userMigration = await writeFile(
      path.join(
        baseDir,
        'database',
        'migrations',
        `${timestampSuffix(0)}_create_users_table.js`,
      ),
      await read('user-migration.tyx'),
      { overwrite: true },
    )

    results.refreshTokenMigration = await writeFile(
      path.join(
        baseDir,
        'database',
        'migrations',
        `${timestampSuffix(1000)}_create_refresh_tokens_table.js`,
      ),
      await read('refresh-token-migration.tyx'),
      { overwrite: true },
    )

    results.passwordResetMigration = await writeFile(
      path.join(
        baseDir,
        'database',
        'migrations',
        `${timestampSuffix(2000)}_create_password_resets_table.js`,
      ),
      await read('password-reset-migration.tyx'),
      { overwrite: true },
    )

    return results
  }
}
