import fs from 'node:fs/promises'
import path from 'node:path'
import { Blueprint, MigrationGenerator } from '@tylix/generator'
import { columnModifiers, detectLanguage, parseFieldArg, resolveColumnType } from '@tylix/shared'

// tylix make:migration, reading what to do from the name, as Laravel does:
//
//   make:migration posts title:string            create table "posts" (as before)
//   make:migration create_posts_table title:string
//   make:migration add_status_to_posts_table status:string:index:default=draft
//   make:migration remove_legacy_from_posts_table legacy:text
//   make:migration tune_posts --table=posts      an empty alterTable to fill in
//   make:migration seed_roles --create=roles     an empty createTable

export function inferMigration(name, { table, create } = {}) {
  if (create) return { kind: 'create', table: create }
  if (table) return { kind: 'alter', table }
  let m
  if ((m = /^create_(\w+?)_table$/.exec(name))) return { kind: 'create', table: m[1] }
  if ((m = /^add_\w+?_to_(\w+?)(_table)?$/.exec(name))) return { kind: 'add', table: m[1] }
  if ((m = /^(remove|drop)_\w+?_from_(\w+?)(_table)?$/.exec(name))) return { kind: 'remove', table: m[2] }
  if (/^\w+$/.test(name) && !name.includes('_')) return { kind: 'create', table: name, legacy: true }
  if ((m = /_(?:in|on|to|from)_(\w+?)(_table)?$/.exec(name))) return { kind: 'alter', table: m[1] }
  return { kind: 'alter', table: null }
}

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
}

const column = (f) => `        table.${resolveColumnType(f.type)}("${f.name}")${columnModifiers(f)};`

export function alterMigrationSource({ table, up, down, ts }) {
  const types = ts ? "import type { Schema, AlterTableBuilder } from '@tylix/shared'\n\n" : ''
  const S = ts ? ': Schema' : ''
  const T = ts ? ': AlterTableBuilder' : ''
  const body = (lines, hint) => (lines.length ? lines.join('\n') : `        // ${hint}`)
  return `${types}export const up = async (schema${S}) => {
    await schema.alterTable("${table}", (table${T}) => {
${body(up, 'table.string("subtitle").nullable(); table.string("title", 500).change(); table.index(["status"])')}
    });
};

export const down = async (schema${S}) => {
    await schema.alterTable("${table}", (table${T}) => {
${body(down, 'undo what up() did')}
    });
};
`
}

export async function makeMigration(name, fieldArgs = [], options = {}) {
  if (!name) throw new Error('Usage: tylix make:migration <name> [field:type:modifiers ...] [--table=name | --create=name]')
  const baseDir = process.cwd()
  const language = await detectLanguage(baseDir)
  const ts = language === 'typescript'
  const fields = fieldArgs.map(parseFieldArg)
  const plan = inferMigration(name, options)
  const outputDir = path.join(baseDir, 'database', 'migrations')

  if (plan.kind === 'create') {
    const blueprint = new Blueprint(plan.table)
    blueprint.table(plan.table)
    for (const { name: field, type, ...rest } of fields) blueprint.field(field, type, rest)
    const outputPath = await new MigrationGenerator().generate(blueprint, outputDir, language)
    console.log(`✔ Migration created: ${path.relative(baseDir, outputPath)}`)
    return outputPath
  }

  if (!plan.table) {
    throw new Error(`Can't tell which table "${name}" changes. Name it like add_status_to_posts_table, or pass --table=posts.`)
  }
  let up = []
  let down = []
  if (plan.kind === 'add') {
    for (const f of fields) {
      if (f.nullable === false && f.default === undefined) {
        throw new Error(`"${f.name}" is required but has no default; rows already in "${plan.table}" would have no value. Add default=<value>.`)
      }
    }
    up = fields.map(column)
    down = fields.length ? [`        table.dropColumn(${fields.map((f) => JSON.stringify(f.name)).join(', ')});`] : []
  } else if (plan.kind === 'remove') {
    up = fields.length ? [`        table.dropColumn(${fields.map((f) => JSON.stringify(f.name)).join(', ')});`] : []
    down = fields.map(column)
  }
  const file = path.join(outputDir, `${stamp()}_${name}.${ts ? 'ts' : 'js'}`)
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(file, alterMigrationSource({ table: plan.table, up, down, ts }))
  console.log(`✔ Migration created: ${path.relative(baseDir, file)}`)
  return file
}
