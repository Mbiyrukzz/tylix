import fs from 'node:fs/promises'
import path from 'node:path'

// True when `filePath` exists (file or folder).
export async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function writeFile(filePath, content, { overwrite = false } = {}) {
  if (!overwrite && (await exists(filePath))) {
    throw new Error(`File already exists: ${filePath}. Pass { overwrite: true } to replace it.`)
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}
