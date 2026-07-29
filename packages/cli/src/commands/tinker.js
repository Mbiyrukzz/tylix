import repl from 'node:repl'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { bootstrapDatabase } from '../bootstrap.js'
import { loadConfig, detectLanguage } from '@tylix/shared'
import { cache, discoverFeatures } from '@tylix/core'
import { ConnectionManager } from '@tylix/orm'
import { migrate } from './migrate.js'

async function listFiles(dir, ext) {
  const exists = await fs
    .access(dir)
    .then(() => true)
    .catch(() => false)
  if (!exists) return []
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

export async function tinker() {
  const baseDir = process.cwd()
  await bootstrapDatabase()

  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'

  const modelsDir = path.join(baseDir, 'app', 'models')
  const context = {}

  const modelExists = await fs
    .access(modelsDir)
    .then(() => true)
    .catch(() => false)
  if (modelExists) {
    const files = (await fs.readdir(modelsDir)).filter((f) =>
      f.endsWith(`.${ext}`),
    )
    for (const file of files) {
      const exportName = file.replace(new RegExp(`\\.${ext}$`), '')
      const mod = await import(pathToFileURL(path.join(modelsDir, file)).href)
      if (mod[exportName]) context[exportName] = mod[exportName]
    }
  }

  context.migrate = migrate
  context.cache = cache

  context.seed = async () => {
    const seederPath = path.join(
      baseDir,
      'app',
      'seeders',
      `DatabaseSeeder.${ext}`,
    )
    const exists = await fs
      .access(seederPath)
      .then(() => true)
      .catch(() => false)
    if (!exists)
      throw new Error(`No seeder found at app/seeders/DatabaseSeeder.${ext}`)
    const mod = await import(pathToFileURL(seederPath).href)
    return mod.seed()
  }

  context.models = () => {
    console.log(Object.keys(context).filter((k) => context[k]?.getTable))
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
    const exists = await fs
      .access(featuresDir)
      .then(() => true)
      .catch(() => false)
    if (!exists) return console.log([])
    const entries = await fs.readdir(featuresDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(featuresDir, entry.name, 'feature.json')
      const manifestExists = await fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false)
      if (!manifestExists) continue
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

    const authControllerExists = await fs
      .access(path.join(baseDir, 'app', 'controllers', `AuthController.${ext}`))
      .then(() => true)
      .catch(() => false)
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
    const exists = await fs
      .access(mailerPath)
      .then(() => true)
      .catch(() => false)
    if (!exists) {
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
Commands
  models()          list loaded model names
  pages()            list page files under app/pages
  features()         print each feature's feature.json
  config()            print loaded tylix.config.js
  env()               print environment variables (secrets masked)
  tables()            list tables/collections in the connected database
  cacheEntries()      list current cache table rows
  routes()            approximate page routes (see note below)
  mail()              load mailer functions into scope, if present
  migrate()           run pending migrations
  seed()              run app/seeders/DatabaseSeeder.js
  cache               cache.get/set/has/forget/clear

Note: routes() only covers page routes today.
`)
  }

  console.log(
    `Tylix Tinker — type help() for commands. Models loaded: ${
      Object.keys(context)
        .filter((k) => context[k]?.getTable)
        .join(', ') || '(none found in app/models)'
    }\n`,
  )

  const replServer = repl.start({
    prompt: 'tylix> ',
    useGlobal: false,
    ignoreUndefined: true,
  })
  Object.assign(replServer.context, context)
  replServer.on('exit', () => process.exit(0))
}
