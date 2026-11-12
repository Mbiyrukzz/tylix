import fs from 'node:fs/promises'
import path from 'node:path'

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export async function loadEnv(baseDir = process.cwd()) {
  const envPath = path.join(baseDir, '.env')
  const exists = await fs
    .access(envPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return

  // A BOM at the start of the file (some Windows editors add one) would
  // otherwise become part of the first key name.
  const raw = (await fs.readFile(envPath, 'utf-8')).replace(/^\uFEFF/, '')

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    // Allow `export KEY=value`, so the file also works with `source .env`.
    const key = trimmed
      .slice(0, eqIndex)
      .trim()
      .replace(/^export\s+/, '')
    if (!KEY_PATTERN.test(key)) continue

    let value = trimmed.slice(eqIndex + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }

    // A variable already set in the shell wins over the file.
    if (!(key in process.env)) process.env[key] = value
  }
}