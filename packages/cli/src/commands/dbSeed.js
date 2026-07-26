import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { bootstrapDatabase } from '../bootstrap.js'

export async function dbSeed() {
  const baseDir = process.cwd()
  await bootstrapDatabase()

  const seederPath = path.join(baseDir, 'app', 'seeders', 'DatabaseSeeder.js')
  const exists = await fs
    .access(seederPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    console.error(`No seeder found at app/seeders/DatabaseSeeder.js`)
    process.exit(1)
  }

  const mod = await import(pathToFileURL(seederPath).href)
  await mod.seed()
  console.log('✔ Database seeded')
}
