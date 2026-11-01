import repl from 'node:repl'
import fs from 'node:fs/promises'
import path from 'node:path'
import { inspect } from 'node:util'
import { pathToFileURL } from 'node:url'
import { bootstrapDatabase } from '../bootstrap.js'
import { loadConfig, detectLanguage } from '@tylix/shared'
import { cache, discoverFeatures } from '@tylix/core'
import { ConnectionManager } from '@tylix/orm'
import { migrate } from './migrate.js'

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

async function listFiles(dir, ext) {
  if (!(await pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await listFiles(full, ext)))
    } else if (entry.name.endsWith(ext)) {
      results.push(path.relative(dir, full))
    }
  }
  return results
}

// Import every model in app/models into `target`.
// `bust` adds a query string so edited files are re-imported fresh.
async function loadModels(modelsDir, ext, target, bust = false) {
  const loaded = []
  if (!(await pathExists(modelsDir))) return loaded

  const files = (await fs.readdir(modelsDir)).filter((f) =>
    f.endsWith(`.${ext}`),
  )
  for (const file of files) {
    const exportName = file.replace(new RegExp(`\\.${ext}$`), '')
    const href = pathToFileURL(path.join(modelsDir, file)).href
    try {
      const mod = await import(bust ? `${href}?t=${Date.now()}` : href)
      if (mod[exportName]) {
        target[exportName] = mod[exportName]
        loaded.push(exportName)
      }
    } catch (err) {
      console.error(`Could not load model ${file}: ${err.message}`)
    }
  }
  return loaded
}

function tableOf(model) {
  try {
    return typeof model.getTable === 'function' ? model.getTable() : null
  } catch {
    return null
  }
}

// List the methods available on a model (static + instance), walking the
// prototype chain so inherited ORM methods show up too.
function listMethods(model) {
  if (typeof model !== 'function') {
    console.log('Pass a model class, e.g. methods(Customer)')
    return
  }

  const collect = (obj, stopAt) => {
    const names = new Set()
    let current = obj
    while (current && current !== stopAt) {
      for (const name of Object.getOwnPropertyNames(current)) {
        if (
          ['constructor', 'prototype', 'length', 'name'].includes(name) ||
          name.startsWith('_')
        )
          continue
        const desc = Object.getOwnPropertyDescriptor(current, name)
        if (typeof desc.value === 'function') names.add(name)
      }
      current = Object.getPrototypeOf(current)
    }
    return [...names].sort()
  }

  console.log(`\n${model.name}`)
  console.log('  Static:  ', collect(model, Function.prototype).join(', '))
  console.log(
    '  Instance:',
    collect(model.prototype, Object.prototype).join(', '),
  )
  console.log('')
}

// Table, fillable fields, timestamps and row count for a model.
async function describeModel(model) {
  if (typeof model !== 'function' || typeof model.getTable !== 'function') {
    console.log('Pass a model class, e.g. info(Customer)')
    return
  }
  const table = tableOf(model)
  console.log(`\n${model.name}`)
  console.log(`  table:      ${table ?? '(not defined)'}`)
  console.log(`  fillable:   ${(model.fillable ?? []).join(', ') || '(none)'}`)
  console.log(`  timestamps: ${model.timestamps ? 'yes' : 'no'}`)
  try {
    console.log(`  rows:       ${await model.count()}`)
  } catch (err) {
    console.log(`  rows:       could not count (${err.message})`)
  }
  console.log('')
}

export async function tinker() {
  const baseDir = process.cwd()
  await bootstrapDatabase()

  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'

  const modelsDir = path.join(baseDir, 'app', 'models')
  const context = {}

  await loadModels(modelsDir, ext, context)

  const modelNames = () =>
    Object.keys(replServer?.context ?? context).filter(
      (k) => (replServer?.context ?? context)[k]?.getTable,
    )

  context.migrate = migrate
  context.cache = cache
  context.methods = listMethods
  context.info = describeModel

  // Raw database access, like Laravel's DB facade:
  //   db.all("SELECT * FROM customers WHERE id > ?", [10])
  //   db.get("SELECT * FROM customers WHERE id = ?", [1])
  //   db.run("UPDATE customers SET name = ? WHERE id = ?", ["Ann", 1])
  context.db = ConnectionManager.getAdapter()

  // Print rows as a table: show(Customer.all())
  context.show = async (value) => {
    const rows = await value
    if (Array.isArray(rows) && rows.length > 0) console.table(rows)
    else if (Array.isArray(rows)) console.log('(no rows)')
    else if (rows && rows.data && Array.isArray(rows.data)) {
      console.table(rows.data)
      console.log(rows.meta)
    } else console.log(rows)
  }

  context.seed = async () => {
    const seederPath = path.join(
      baseDir,
      'app',
      'seeders',
      `DatabaseSeeder.${ext}`,
    )
    if (!(await pathExists(seederPath)))
      throw new Error(`No seeder found at app/seeders/DatabaseSeeder.${ext}`)
    const mod = await import(pathToFileURL(seederPath).href)
    return mod.seed()
  }

  context.models = () => {
    for (const name of modelNames()) {
      const table = tableOf(replServer.context[name])
      console.log(`  ${name}${table ? `  →  ${table}` : ''}`)
    }
  }

  context.reload = async () => {
    const loaded = await loadModels(modelsDir, ext, replServer.context, true)
    console.log(`Reloaded: ${loaded.join(', ') || '(no models found)'}`)
  }

  context.config = async () => {
    console.log(await loadConfig(baseDir))
  }

  context.env = () => {
    const safe = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith('npm_') && !key.startsWith('_')) {
        safe[key] = /SECRET|PASSWORD|KEY/i.test(key) ? '••••••••' : value
      }
    }
    console.log(safe)
  }

  context.pages = async () => {
    console.log(await listFiles(path.join(baseDir, 'app', 'pages'), '.tyx'))
  }

  context.features = async () => {
    const featuresDir = path.join(baseDir, 'app', 'Features')
    if (!(await pathExists(featuresDir))) return console.log([])
    const entries = await fs.readdir(featuresDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(featuresDir, entry.name, 'feature.json')
      if (!(await pathExists(manifestPath))) continue
      console.log(JSON.parse(await fs.readFile(manifestPath, 'utf-8')))
    }
  }

  context.tables = async () => {
    const adapter = ConnectionManager.getAdapter()
    console.log(await adapter.listTables())
  }

  context.cacheEntries = async () => {
    const { CacheRecord } = await import('@tylix/core')
    console.log(await CacheRecord.all())
  }

  context.exit = () => process.exit(0)

  context.routes = async () => {
    const pageFiles = await listFiles(
      path.join(baseDir, 'app', 'pages'),
      '.tyx',
    )
    const pageRoutes = pageFiles
      .filter(
        (f) => f !== '_layout.tyx' && !f.includes(`components${path.sep}`),
      )
      .map((f) => {
        const withoutExt = f.replace(/\.tyx$/, '')
        const segments = withoutExt.split(path.sep).map((s) => s.toLowerCase())
        if (segments[segments.length - 1] === 'index') segments.pop()
        return '/' + segments.join('/')
      })

    console.log('Page routes:')
    console.log(pageRoutes)

    const features = await discoverFeatures(baseDir)
    console.log('\nFeature routes:')
    if (features.length === 0) {
      console.log('(none found in app/Features)')
    }
    for (const { manifest } of features) {
      const authNote = manifest.auth ? '  (auth required)' : ''
      console.log(`  GET     /api/${manifest.table}${authNote}`)
      console.log(`  POST    /api/${manifest.table}${authNote}`)
      console.log(`  GET     /api/${manifest.table}/:id${authNote}`)
      console.log(`  PUT     /api/${manifest.table}/:id${authNote}`)
      console.log(`  DELETE  /api/${manifest.table}/:id${authNote}`)
    }

    const authControllerExists = await pathExists(
      path.join(baseDir, 'app', 'controllers', `AuthController.${ext}`),
    )
    if (authControllerExists) {
      console.log('\nAuth routes:')
      console.log([
        'POST /api/register',
        'POST /api/login',
        'POST /api/auth/refresh',
        'POST /api/auth/logout',
        'GET  /api/auth/verify-email',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password',
        'GET  /api/me',
      ])
    }

    console.log(
      '\nNote: custom routes registered in app/routes/web.js are not shown here.',
    )
  }

  context.mail = async () => {
    const mailerPath = path.join(baseDir, 'app', 'mail', `mailer.${ext}`)
    if (!(await pathExists(mailerPath))) {
      console.log(`No Mailer file found at app/mail/mailer.${ext}.`)
      return
    }
    const mod = await import(pathToFileURL(mailerPath).href)
    const available = [
      'sendVerificationEmail',
      'sendPasswordResetEmail',
    ].filter((fn) => typeof mod[fn] === 'function')
    console.log(`Mailer: app/mail/mailer.${ext}`)
    console.log(`Functions: ${available.join(', ') || '(none found)'}`)
    console.log(
      `Currently console.log-only (dev stub) — swap in a real provider before production.`,
    )
    if (mod.sendVerificationEmail)
      context.sendVerificationEmail = mod.sendVerificationEmail
    if (mod.sendPasswordResetEmail)
      context.sendPasswordResetEmail = mod.sendPasswordResetEmail
  }

  context.help = () => {
    console.log(`
CRUD (no "await" needed)
  Customer.all()                          every row
  Customer.find(1)                        one row by id
  Customer.findOrFail(1)                  one row, throws if missing
  Customer.create({ name: "Ann" })        insert (fillable fields only)
  Customer.update(1, { name: "Bob" })     update by id, returns the row
  Customer.delete(1)                      delete by id (always returns true)
  Customer.destroy(1, 2, 3)               delete several, returns how many existed
  Customer.first()                        first row
  Customer.count()                        number of rows
  Customer.exists()                       true if the table has any row
  Customer.paginate({ page: 2, limit: 10, where: { status: "active" } })

Find or create
  Customer.firstOrCreate({ email: "a@b.com" }, { name: "Ann" })
  Customer.updateOrCreate({ email: "a@b.com" }, { name: "Anna" })

Queries
  Customer.where("status", "active").get()
  Customer.where("age", ">", 18).latest().limit(5).get()
  Customer.where("name", "LIKE", "A%").get()
  Customer.where("status", "<>", "banned").get()
  Customer.where("email", "a@b.com").first()
  Customer.where("deleted_at", null).get()      same as whereNull
  Customer.whereNull("deleted_at").get()
  Customer.whereNotNull("email_verified_at").get()
  Customer.whereIn("id", [1, 2, 3]).get()
  Customer.whereNotIn("status", ["banned", "spam"]).get()
  Customer.latest().first()                     newest row (also: oldest())
  Customer.pluck("email")                       one column as an array
  Customer.pluck("email", "id")                 { id: email, ... }
  Customer.query().where(...).orderBy("name", "ASC").get()

  Conditions can be chained: Customer.whereNull("deleted_at").where("age", ">", 18).get()
  Operators: =  !=  <>  >  <  >=  <=  LIKE (any case)  IN  NOT IN
  Column names must be plain identifiers (letters, digits, underscore).
  IN lists take at most 1000 values and can't contain null.

Relations
  Post.belongsTo(post, "customer_id", Customer)
  Customer.hasMany(customer, Post, "customer_id")

Inspect
  models()              list loaded models and their tables
  info(Model)           table, fillable fields, timestamps, row count
  methods(Model)        list the methods a model has
  show(Customer.all())  print rows as a table
  reload()              re-import models after editing them

Database
  db.all(sql, params)   raw SELECT returning many rows
  db.get(sql, params)   raw SELECT returning one row
  db.run(sql, params)   raw INSERT/UPDATE/DELETE
  tables()              list tables/collections in the connected database
  migrate()             run pending migrations
  seed()                run app/seeders/DatabaseSeeder.${ext}

Project
  features()            print each feature's feature.json
  pages()               list page files under app/pages
  routes()              page and feature routes (custom routes not shown)
  config()              print loaded tylix.config
  env()                 print environment variables (secrets masked)
  mail()                load mailer functions into scope, if present
  cacheEntries()        list current cache table rows
  cache                 cache.get/set/has/forget/clear

REPL
  .exit / exit()        leave Tinker
  .clear                reset the current multi-line input
`)
  }

  const loadedNames = Object.keys(context).filter((k) => context[k]?.getTable)
  console.log(
    `Tylix Tinker — type help() for commands.\nModels loaded: ${
      loadedNames.join(', ') || '(none found in app/models)'
    }\n`,
  )

  const replServer = repl.start({
    prompt: 'tylix> ',
    useGlobal: false,
    ignoreUndefined: true,
    writer: (value) =>
      inspect(value, {
        colors: true,
        depth: 4,
        maxArrayLength: 50,
        breakLength: 80,
      }),
  })

  // Auto-await: `Customer.all()` prints the rows instead of "Promise { <pending> }".
  const defaultEval = replServer.eval
  replServer.eval = function (cmd, ctx, filename, callback) {
    defaultEval.call(this, cmd, ctx, filename, async (err, result) => {
      if (err) return callback(err)
      try {
        callback(null, await result)
      } catch (e) {
        callback(e)
      }
    })
  }

  // Persistent history across sessions.
  replServer.setupHistory(path.join(baseDir, '.tylix_tinker_history'), (err) => {
    if (err) console.error(`Could not set up history: ${err.message}`)
  })

  Object.assign(replServer.context, context)
  replServer.on('exit', () => process.exit(0))
}