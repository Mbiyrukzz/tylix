import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Blueprint,
  ModelGenerator,
  ControllerGenerator,
  ValidatorGenerator,
  AlterMigrationGenerator,
} from '@tylix/generator'

import { detectLanguage } from '@tylix/shared'

export async function fieldRemove(name, fieldNames = []) {
  const baseDir = process.cwd()
  const language = await detectLanguage(baseDir)

  const manifestPath = path.join(
    baseDir,
    'app',
    'Features',
    name,
    'feature.json',
  )

  const exists = await fs
    .access(manifestPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    console.error(`No feature found at app/Features/${name}/feature.json.`)
    process.exit(1)
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))

  const missing = fieldNames.filter(
    (fn) => !manifest.fields.some((f) => f.name === fn),
  )
  if (missing.length > 0) {
    console.error(`Field(s) not found on ${name}: ${missing.join(', ')}`)
    process.exit(1)
  }

  const toRemove = manifest.fields.filter((f) => fieldNames.includes(f.name))

  const migrationsDir = path.join(baseDir, 'database', 'migrations')
  const migrationPath = await new AlterMigrationGenerator().generateRemove(
    manifest.table,
    toRemove,
    migrationsDir,
    language,
  )

  console.log(`✔ Migration created: ${path.relative(baseDir, migrationPath)}`)

  manifest.fields = manifest.fields.filter((f) => !fieldNames.includes(f.name))
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

  const fullBlueprint = new Blueprint(name)
  for (const f of manifest.fields) {
    fullBlueprint.field(f.name, f.type, { unique: f.unique })
  }
  fullBlueprint.table(manifest.table)
  if (manifest.auth) fullBlueprint.auth()

  for (const rel of manifest.relations ?? []) {
    if (rel.type === 'belongsTo')
      fullBlueprint.belongsTo(rel.model, { foreignKey: rel.foreignKey })
    if (rel.type === 'hasMany')
      fullBlueprint.hasMany(rel.model, { foreignKey: rel.foreignKey })
  }

  await new ModelGenerator().generate(
    fullBlueprint,
    path.join(baseDir, 'app', 'models'),
    language,
  )
  await new ControllerGenerator().generate(
    fullBlueprint,
    path.join(baseDir, 'app', 'controllers'),
    language,
  )
  await new ValidatorGenerator().generate(
    fullBlueprint,
    path.join(baseDir, 'app', 'validators'),
    language,
  )

  console.log(`✔ Model, controller, and validator regenerated for ${name}`)
  console.log(`\nRun "tylix migrate" to apply the change.`)
}
