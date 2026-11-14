import path from 'node:path'
import { AuthGenerator } from '@tylix/auth'

export async function makeAuth() {
  const baseDir = process.cwd()
  const generator = new AuthGenerator()
  const results = await generator.generate(baseDir)
  const rel = (p) => path.relative(baseDir, p)

  console.log(`\n✔ Auth scaffolding created:\n`)
  console.log(`  Models`)
  console.log(`    User:           ${rel(results.userModel)}`)
  console.log(`    AuthSession:    ${rel(results.sessionModel)}`)
  console.log(`    PasswordReset:  ${rel(results.passwordResetModel)}`)
  console.log(`  Validator:        ${rel(results.validator)}`)
  console.log(`  Controller:       ${rel(results.controller)}`)
  console.log(
    `  Mailer:           ${rel(results.mailer)} (edit this before going live)`,
  )
  console.log(`  Migrations`)
  console.log(`    users:            ${rel(results.userMigration)}`)
  console.log(`    auth_sessions:    ${rel(results.sessionMigration)}`)
  console.log(`    password_resets:  ${rel(results.passwordResetMigration)}`)
  console.log(
    `\nRun "tylix migrate" then "tylix dev" to get:\n` +
      `  POST /api/register\n` +
      `  POST /api/login\n` +
      `  POST /api/auth/refresh\n` +
      `  POST /api/auth/logout\n` +
      `  GET  /api/auth/verify-email\n` +
      `  POST /api/auth/forgot-password\n` +
      `  POST /api/auth/reset-password\n` +
      `  POST /api/auth/resend-verification\n` +
      `  POST /api/auth/change-password\n` +
      `  GET  /api/auth/sessions          (your signed-in devices)\n` +
      `  DEL  /api/auth/sessions/:id\n` +
      `  POST /api/auth/logout-all\n` +
      `  GET  /api/me\n`,
  )
}
