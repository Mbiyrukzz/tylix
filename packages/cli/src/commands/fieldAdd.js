import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Blueprint,
  ModelGenerator,
  ControllerGenerator,
  ValidatorGenerator,
  AlterMigrationGenerator,
} from '@tylix/generator'

export async function fieldAdd(name, fieldArgs = []) {
  const baseDir = process.cwd()
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
    console.error(
      `No feature found at app/Features/${name}/feature.json. Run "tylix make:feature ${name} ..." first.`,
    )
    process.exit(1)
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))

  const newFields = fieldArgs.map((arg) => {
    const [fieldName, fieldType = 'string', modifier] = arg.split(':')
    return { name: fieldName, type: fieldType, unique: modifier === 'unique' }
  })

  for (const f of newFields) {
    if (manifest.fields.some((existing) => existing.name === f.name)) {
      console.error(`Field "${f.name}" already exists on ${name}.`)
      process.exit(1)
    }
  }

  const alterBlueprint = new Blueprint(name)
  for (const f of newFields) {
    alterBlueprint.field(f.name, f.type, { unique: f.unique })
  }
  alterBlueprint.table(manifest.table)

  const migrationsDir = path.join(baseDir, 'database', 'migrations')
  const migrationPath = await new AlterMigrationGenerator().generateAdd(
    alterBlueprint,
    migrationsDir,
  )
  console.log(`✔ Migration created: ${path.relative(baseDir, migrationPath)}`)

  manifest.fields = [...manifest.fields, ...newFields]
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
  )
  await new ControllerGenerator().generate(
    fullBlueprint,
    path.join(baseDir, 'app', 'controllers'),
  )
  await new ValidatorGenerator().generate(
    fullBlueprint,
    path.join(baseDir, 'app', 'validators'),
  )

  console.log(`✔ Model, controller, and validator regenerated for ${name}`)
  console.log(`\nRun "tylix migrate" to apply the new column.`)
}
