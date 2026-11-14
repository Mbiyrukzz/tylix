import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthGenerator } from './AuthGenerator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('generates auth models, validator, controller, mail files and migrations', async () => {
  const outputDir = path.join(__dirname, '.tmp-test-output')
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  try {
    const results = await new AuthGenerator().generate(outputDir)

    // Every key the generator reports must point at a real file.
    const expected = [
      'userModel',
      'sessionModel',
      'passwordResetModel',
      'validator',
      'controller',
      'mailer',
      'verifyEmailMail',
      'resetPasswordMail',
      'verifyEmailView',
      'resetPasswordView',
      'userMigration',
      'sessionMigration',
      'passwordResetMigration',
      'oauthAccountModel',
      'oauthAccountMigration',
      'userObserver',
      'welcomeJob',
    ]
    for (const key of expected) {
      assert.ok(results[key], `generate() returned no path for "${key}"`)
      await fs.access(results[key])
    }

    const read = (key) => fs.readFile(results[key], 'utf-8')

    assert.match(await read('userModel'), /export class User extends Model/)
    assert.match(await read('sessionModel'), /export class AuthSession/)
    assert.match(await read('passwordResetModel'), /export class PasswordReset/)
    assert.match(await read('validator'), /export function validateRegister/)
    assert.match(await read('validator'), /export function validateLogin/)

    const controller = await read('controller')
    assert.match(controller, /export class AuthController/)
    assert.match(controller, /async register\(req, res\)/)
    assert.match(controller, /async login\(req, res\)/)
    assert.match(controller, /async me\(req, res\)/)

    assert.match(await read('userMigration'), /createTable\("users"/)
    assert.match(await read('userModel'), /static observers = \[UserObserver\]/)
    assert.match(await read('userObserver'), /dispatch\("SendWelcomeEmail", \{ userId: user\.id \}\)/)
    assert.match(await read('welcomeJob'), /export const SendWelcomeEmail/)
    assert.match(await read('sessionMigration'), /createTable\("auth_sessions"/)
    assert.match(await read('passwordResetMigration'), /createTable\("password_resets"/)
    assert.match(await read('oauthAccountModel'), /export class OAuthAccount extends Model/)
    assert.match(await read('oauthAccountMigration'), /createTable\("oauth_accounts"/)
    assert.match(controller, /async oauthStart\(req, res\)/)
    assert.match(controller, /async oauthCallback\(req, res\)/)
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true })
  }
})

test('running make:auth again keeps the existing migrations instead of adding copies', async () => {
  const outputDir = path.join(__dirname, '.tmp-test-output-rerun')
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  try {
    const first = await new AuthGenerator().generate(outputDir)
    // Stands in for a migration that has already run and been edited.
    await fs.appendFile(first.userMigration, '\n// already applied\n')

    const second = await new AuthGenerator().generate(outputDir)

    const migrations = (await fs.readdir(path.join(outputDir, 'database', 'migrations'))).sort()
    assert.equal(migrations.length, 4, `expected 4 migrations, found: ${migrations.join(', ')}`)
    assert.equal(second.userMigration, first.userMigration)
    assert.equal(second.sessionMigration, first.sessionMigration)
    assert.equal(second.passwordResetMigration, first.passwordResetMigration)
    assert.equal(second.oauthAccountMigration, first.oauthAccountMigration)
    assert.match(await fs.readFile(second.userMigration, 'utf-8'), /already applied/, 'existing file left untouched')
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true })
  }
})