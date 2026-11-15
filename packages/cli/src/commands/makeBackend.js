import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage, exists } from '@tylix/shared'

// make:job, make:observer and make:trait. Each writes one file and never
// replaces an existing one.

const NAME = /^[A-Z][A-Za-z0-9]*$/

function checkName(kind, name) {
  if (!NAME.test(name ?? '')) {
    throw new Error(`"${name}" is not a valid ${kind} name. Use PascalCase letters and digits, e.g. SendInvoice.`)
  }
}


async function writeNew(baseDir, file, content) {
  if (await exists(file)) throw new Error(`${path.relative(baseDir, file)} already exists.`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function project() {
  const baseDir = process.cwd()
  const ts = (await detectLanguage(baseDir)) === 'typescript'
  return { baseDir, ts, ext: ts ? 'ts' : 'js' }
}

// ---- make:job ------------------------------------------------------------

export function jobSource(name, ts) {
  const P = ts ? ': Record<string, unknown>' : ''
  return `${ts ? "import type { JobHandler } from '@tylix/core'\n\n" : ''}// Runs in the background, outside any request (start the worker with
// "tylix queue:work"). Queue it from a controller, observer or service:
//   import { dispatch } from '@tylix/core'
//   await dispatch('${name}', { /* payload */ })
//   await dispatch('${name}', { /* payload */ }, { delay: 60 })  // in a minute
export const ${name}${ts ? ': JobHandler' : ''} = {
  // Attempts in total, and the seconds to wait before each retry (the last
  // wait repeats). backoff: 'exponential' doubles the wait each time.
  tries: 3,
  backoff: [10, 60, 300],
  // Seconds an attempt may run before it counts as failed (0: no limit).
  timeout: 120,

  async handle(payload${P}) {
    // The work goes here. Throwing retries the job; after the last attempt
    // it is marked failed ("tylix queue:failed", "tylix queue:retry <id>").
    // Throw new PermanentJobError(...) from '@tylix/core' to fail at once.
  },

  async failed(payload${P}, error${ts ? ': Error' : ''}) {
    // Called once, after the last attempt failed: tell someone, undo work.
  },
}
`
}

// ---- make:queue-retries ----------------------------------------------------

// Jobs tables made before 1.6 have no available_at column, so retries
// can't wait between attempts. This writes the migration that adds it.
export async function makeQueueRetries() {
  const { baseDir, ts, ext } = await project()
  const dir = path.join(baseDir, 'database', 'migrations')
  const existing = await fs.readdir(dir).catch(() => [])
  if (existing.some((f) => /_add_available_at_to_jobs_table\./.test(f))) {
    console.log('✔ The available_at migration already exists. Run "tylix migrate".')
    return
  }
  // UTC, like every other generated migration, so they sort in order.
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const file = path.join(dir, `${stamp}_add_available_at_to_jobs_table.${ext}`)
  const types = ts ? "import type { Schema, AlterTableBuilder } from '@tylix/shared'\n\n" : ''
  await writeNew(
    baseDir,
    file,
    `${types}// When a queued job may run next: dispatch(..., { delay }) and retry backoff.
export const up = async (schema${ts ? ': Schema' : ''}) => {
  await schema.alterTable('jobs', (table${ts ? ': AlterTableBuilder' : ''}) => {
    table.datetime('available_at')
  })
}

export const down = async (schema${ts ? ': Schema' : ''}) => {
  await schema.alterTable('jobs', (table${ts ? ': AlterTableBuilder' : ''}) => {
    table.dropColumn('available_at')
  })
}
`,
  )
  console.log(`\n✔ Migration created: ${path.relative(baseDir, file)}\n  Run "tylix migrate", then restart "tylix queue:work".\n`)
}

export async function makeJob(name) {
  checkName('job', name)
  const { baseDir, ts, ext } = await project()
  const file = path.join(baseDir, 'app', 'jobs', `${name}.${ext}`)
  await writeNew(baseDir, file, jobSource(name, ts))
  console.log(`\n✔ Job created: ${path.relative(baseDir, file)}`)
  console.log(`  Queue it:  await dispatch('${name}', { ... })   (dispatch from '@tylix/core')`)
  console.log(`  Run jobs:  tylix queue:work\n`)
}

// ---- make:observer -------------------------------------------------------

export function observerSource(name, model, ts) {
  const row = ts ? ': Record<string, unknown>' : ''
  return `// Runs when ${model} rows are created, updated or deleted. Enabled by
// \`static observers = [${name}]\` in app/models/${model}.
//
// Every hook is optional and may be async. Only define the hooks you need:
// updating/updated/deleting/deleted make the model read the row first.
export class ${name} {
  // Before an insert: return a new object to change the data, throw to cancel.
  // creating(data${row}) {}

  // After an insert.
  async created(${model.toLowerCase()}${row}) {
    // e.g. await dispatch('SendWelcomeEmail', { userId: ${model.toLowerCase()}.id })
  }

  // Before an update (before = the row as it was): return new data or throw.
  // updating(data${row}, before${row}) {}

  // After an update.
  // updated(${model.toLowerCase()}${row}, before${row}) {}

  // Before a delete: throw to cancel.
  // deleting(${model.toLowerCase()}${row}) {}

  // After a delete.
  // deleted(${model.toLowerCase()}${row}) {}
}
`
}

// Adds the import and `static observers = [...]` to a model file. Returns
// null when it can't do so safely (unusual layout, observers already set).
export function wireObserver(source, model, observer) {
  if (/static\s+observers\s*=/.test(source)) return null
  // The class body's brace is the last "{" on the line (a trait base like
  // use(Model, Searchable({ ... })) has braces of its own).
  const classLine = new RegExp(`^([ \\t]*)export\\s+class\\s+${model}\\s+extends\\s+.+\\{[ \\t]*$`, 'm')
  const match = classLine.exec(source)
  if (!match) return null
  const lines = source.split('\n')
  const lastImport = lines.reduce((at, line, i) => (/^import\s/.test(line) ? i : at), -1)
  const importLine = `import { ${observer} } from '../observers/${observer}.js'`
  const at = match.index + match[0].length
  let out = source.slice(0, at) + `\n${match[1]}  static observers = [${observer}]` + source.slice(at)
  const outLines = out.split('\n')
  outLines.splice(lastImport + 1, 0, importLine)
  out = outLines.join('\n')
  return out
}

export async function makeObserver(name, { model } = {}) {
  const observer = name?.endsWith('Observer') ? name : `${name}Observer`
  const modelName = model ?? observer.replace(/Observer$/, '')
  checkName('observer', observer)
  checkName('model', modelName)
  const { baseDir, ts, ext } = await project()
  const file = path.join(baseDir, 'app', 'observers', `${observer}.${ext}`)
  await writeNew(baseDir, file, observerSource(observer, modelName, ts))
  console.log(`\n✔ Observer created: ${path.relative(baseDir, file)}`)

  const modelFile = path.join(baseDir, 'app', 'models', `${modelName}.${ext}`)
  const source = await fs.readFile(modelFile, 'utf-8').catch(() => null)
  const wired = source === null ? null : wireObserver(source, modelName, observer)
  if (wired) {
    await fs.writeFile(modelFile, wired)
    console.log(`✔ Enabled in ${path.relative(baseDir, modelFile)} (static observers = [${observer}])\n`)
    return
  }
  console.log(`\n  Enable it in app/models/${modelName}.${ext}:`)
  console.log(`    import { ${observer} } from '../observers/${observer}.js'`)
  if (source?.includes('static observers')) {
    console.log(`    and add ${observer} to its existing static observers = [...]\n`)
  } else {
    console.log(`    static observers = [${observer}]   (inside the class)\n`)
  }
}

// ---- make:trait ----------------------------------------------------------

export function traitSource(name, ts) {
  const signature = ts ? `<T extends typeof Model>(Base: T)` : `(Base)`
  return `${ts ? "import type { Model } from '@tylix/orm'\n\n" : ''}// A trait: model behaviour to share between models. Use it with use():
//   import { Model, use } from '@tylix/orm'
//   import { ${name} } from '../traits/${name}.js'
//   export class Post extends use(Model, ${name}) { ... }
//
// Add static methods (they can use this.where(), this.create(), ...), and
// observer hooks with \`static observers = [...]\`, which run alongside the
// model's own.
export const ${name} = ${signature} =>
  class extends Base {
    // static async recent(days = 7) {
    //   const since = new Date(Date.now() - days * 86_400_000).toISOString()
    //   return this.where('created_at', '>=', since).get()
    // }
  }
`
}

export async function makeTrait(name) {
  checkName('trait', name)
  const { baseDir, ts, ext } = await project()
  const file = path.join(baseDir, 'app', 'traits', `${name}.${ext}`)
  await writeNew(baseDir, file, traitSource(name, ts))
  console.log(`\n✔ Trait created: ${path.relative(baseDir, file)}`)
  console.log(`  Use it in a model:  export class Post extends use(Model, ${name}) { ... }\n`)
}
