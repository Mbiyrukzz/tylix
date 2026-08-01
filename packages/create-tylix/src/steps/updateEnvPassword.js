import fs from 'node:fs/promises'
import path from 'node:path'

// Rewrites only the DATABASE_PASSWORD= line in an already-generated
// .env file, leaving every other line (PORT, AUTH_SECRET, other
// DATABASE_* fields, etc.) untouched. Used by the migration retry
// flow, where the rest of .env is already correct and only the
// password needs correcting.
export async function updateEnvPassword(targetDir, newPassword) {
  const envPath = path.join(targetDir, '.env')
  const raw = await fs.readFile(envPath, 'utf-8')

  const lines = raw.split('\n')
  let found = false
  const updated = lines.map((line) => {
    if (line.startsWith('DATABASE_PASSWORD=')) {
      found = true
      return `DATABASE_PASSWORD=${newPassword}`
    }
    return line
  })

  if (!found) {
    throw new Error(`No DATABASE_PASSWORD= line found in ${envPath}`)
  }

  await fs.writeFile(envPath, updated.join('\n'))
}
