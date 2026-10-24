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
      'refreshTokenModel',
      'passwordResetModel',
      'validator',
      'controller',
      'mailer',
      'verifyEmailMail',
      'resetPasswordMail',
      'verifyEmailView',
      'resetPasswordView',
      'userMigration',
      'refreshTokenMigration',
      'passwordResetMigration',
    ]
    for (const key of expected) {
      assert.ok(results[key], `generate() returned no path for "${key}"`)
      await fs.access(results[key])
    }

    const read = (key) => fs.readFile(results[key], 'utf-8')

    assert.match(await read('userModel'), /export class User extends Model/)
    assert.match(await read('refreshTokenModel'), /export class RefreshToken/)
    assert.match(await read('passwordResetModel'), /export class PasswordReset/)
    assert.match(await read('validator'), /export function validateRegister/)
    assert.match(await read('validator'), /export function validateLogin/)

    const controller = await read('controller')
    assert.match(controller, /export class AuthController/)
    assert.match(controller, /async register\(req, res\)/)
    assert.match(controller, /async login\(req, res\)/)
    assert.match(controller, /async me\(req, res\)/)

    assert.match(await read('userMigration'), /createTable\("users"/)
    assert.match(await read('refreshTokenMigration'), /createTable\("refresh_tokens"/)
    assert.match(await read('passwordResetMigration'), /createTable\("password_resets"/)
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true })
  }
})