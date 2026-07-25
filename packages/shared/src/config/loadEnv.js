import fs from 'node:fs/promises'
import path from 'node:path'

export async function loadEnv(baseDir = process.cwd()) {
  const envPath = path.join(baseDir, '.env')
  const exists = await fs
    .access(envPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return

  const raw = await fs.readFile(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) process.env[key] = value
  }
}
