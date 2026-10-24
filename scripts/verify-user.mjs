#!/usr/bin/env node
// Marks a user as email-verified in a generated app's SQLite database.
// Matrix-test helper: the auth controller refuses login until
// email_verified_at is set, and the model strips that field on create,
// so the test has to set it directly.
//
// Usage: node scripts/verify-user.mjs <database-file> <email>

import { DatabaseSync } from 'node:sqlite'

const [dbFile, email] = process.argv.slice(2)

if (!dbFile || !email) {
  console.error('usage: verify-user.mjs <database-file> <email>')
  process.exit(2)
}

let changes = 0
const db = new DatabaseSync(dbFile)
try {
  // The dev server has the same file open, so wait instead of failing on a lock.
  db.exec('PRAGMA busy_timeout = 5000')
  const result = db
    .prepare('UPDATE users SET email_verified_at = ? WHERE email = ?')
    .run(new Date().toISOString(), email)
  changes = Number(result.changes)
} finally {
  db.close()
}

if (changes !== 1) {
  console.error(`expected to verify 1 user, updated ${changes}`)
  process.exit(1)
}