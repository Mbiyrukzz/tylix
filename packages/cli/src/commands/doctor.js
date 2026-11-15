import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, loadEnv, detectLanguage, parseEnv, exists as pathExists, resolveViewsDir } from '@tylix/shared'
import { discoverFeatures } from '@tylix/core'
import { bootstrapDatabase } from '../bootstrap.js'
import { FRONTEND_PACKAGES, NATIVE_DRIVER, SSR_OUTLET, loadFrontendAdapter } from '../frontend/frontendHost.js'
import { resolveFromProject } from '../frontend/importFromProject.js'
import { findRouteFile, ROUTES_MARKER } from '../frontend/generateFiles.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEV_AUTH_SECRET = 'tylix-dev-secret-change-me'
const LABEL_WIDTH = 30
const MIN_NODE_MAJOR = 22

// Folders the make:* commands write into. Missing ones aren't errors: the
// commands create them. They're reported so an unusual layout is visible.
const APP_FOLDERS = ['controllers', 'models', 'routes', 'services', 'middleware', 'validators', 'jobs', 'observers', 'traits', 'mail', 'seeders']

// The app/server/channels settings as [key, "value  (from …)"] rows.
function settingRows(config) {
  const rows = []
  const walk = (prefix, object) => {
    for (const [name, value] of Object.entries(object)) {
      const key = `${prefix}.${name}`
      if (value && typeof value === 'object' && !Array.isArray(value)) walk(key, value)
      else if (config.sources[key]) rows.push([key, describeSetting(value, config.sources[key])])
    }
  }
  for (const section of ['app', 'server', 'store', 'channels', 'observability']) walk(section, config[section])
  return rows
}

function describeSetting(value, { from, env }) {
  let shown = Array.isArray(value) ? value.join(', ') || '(none)' : value === undefined ? '(unset)' : String(value)
  if (shown.length > 40) shown = `${shown.slice(0, 37)}...`
  const origin = from === 'default' ? 'default' : from === 'tylix.config' ? 'tylix.config' : `${env} in ${from}`
  return `${shown}  (${origin})`
}

// A check returns a detail string (pass), warn('...') (shown, not a
// failure), or throws (failure).
class Warning {
  constructor(message) {
    this.message = message
  }
}
const warn = (message) => new Warning(message)


async function walk(dir, keep) {
  if (!(await pathExists(dir))) return []
  const files = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full, keep)))
    else if (keep(entry.name, full)) files.push(full)
  }
  return files
}

function createReporter() {
  const counts = { ok: 0, warn: 0, fail: 0 }
  async function check(label, fn) {
    // Always at least two spaces between a long label and its detail.
    const name = label.length >= LABEL_WIDTH - 1 ? `${label}  ` : label.padEnd(LABEL_WIDTH)
    try {
      const result = await fn()
      if (result instanceof Warning) {
        counts.warn++
        console.log(`⚠ ${name}${result.message}`)
      } else {
        counts.ok++
        console.log(`✔ ${name}${result ?? ''}`)
      }
      return result
    } catch (err) {
      counts.fail++
      console.log(`✘ ${name}${err.message}`)
      return null
    }
  }
  return { check, counts }
}

export async function doctor() {
  const baseDir = process.cwd()
  const startedAt = performance.now()
  const { check, counts } = createReporter()
  const language = await detectLanguage(baseDir)
  const ts = language === 'typescript'
  const ext = ts ? 'ts' : 'js'
  const rel = (p) => path.relative(baseDir, p)

  console.log('Tylix Doctor')
  console.log('─'.repeat(40))

  // ---- Environment ----
  console.log('Environment')
  await check('Node.js', async () => {
    const major = Number(process.versions.node.split('.')[0])
    if (major < MIN_NODE_MAJOR) throw new Error(`${process.versions.node}: Tylix needs Node ${MIN_NODE_MAJOR} or newer`)
    return process.versions.node
  })
  await check('npm', async () => {
    const { stdout } = await execFileAsync('npm', ['--version'])
    return stdout.trim()
  })
  await check('Tylix', async () => {
    const pkg = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', '..', 'package.json'), 'utf-8'))
    return pkg.version
  })
  console.log()

  // ---- Project ----
  console.log('Project')
  await loadEnv(baseDir)

  let config = null
  // A bad value (PORT=abc, CSP_MODE=strict) fails here, by name.
  await check(`tylix.config.${ext}`, async () => {
    config = await loadConfig(baseDir, language)
    const { driver, ssr } = config.frontend
    return `${language}, frontend: ${driver}${ssr ? ' with SSR' : ''}`
  })
  const production = config ? config.app.production : process.env.NODE_ENV === 'production'
  await check('.env', async () => {
    if (!(await pathExists(path.join(baseDir, '.env')))) throw new Error('missing: copy .env.example to .env')
    const layered = ['.env.local', `.env.${config?.app.env}`, `.env.${config?.app.env}.local`]
    const extra = []
    for (const file of layered) if (await pathExists(path.join(baseDir, file))) extra.push(file)
    const env = config?.app.env ?? 'development'
    return extra.length ? `${env} (+ ${extra.join(', ')})` : env
  })
  await check('.env.example', async () => {
    const file = path.join(baseDir, '.env.example')
    if (!(await pathExists(file))) return warn('missing: commit one so others know which variables to set')
    const keys = parseEnv(await fs.readFile(file, 'utf-8')).map(([key]) => key)
    const missing = keys.filter((key) => process.env[key] === undefined)
    if (missing.length) return warn(`not set anywhere: ${missing.join(', ')}`)
    return `${keys.length} variables, all set`
  })
  if (config) {
    await check('auth secret', async () => {
      const secret = config.auth?.secret
      if (!secret || secret === DEV_AUTH_SECRET) {
        const message = 'AUTH_SECRET is unset or the public dev default'
        if (production) throw new Error(`${message}: anyone could forge logins. Set AUTH_SECRET.`)
        return warn(`${message} (fine for development; set it before production)`)
      }
      if (secret.length < 32) return warn(`AUTH_SECRET is only ${secret.length} characters; use 32 or more`)
      return 'set'
    })
    await check('debug output', async () => {
      const debug = config.app.debug
      if (debug && production) throw new Error('APP_DEBUG=true in production exposes SQL and stack traces. Set it to false.')
      return debug ? 'on (development)' : 'off'
    })
  }

  await check(`routes/web.${ext}`, async () => {
    const file = path.join(baseDir, 'app', 'routes', `web.${ext}`)
    if (!(await pathExists(file))) return warn(`app/routes/web.${ext} is missing (optional)`)
    const mod = await import(pathToFileURL(file).href)
    const exported = ['publicRoutes', 'protectedRoutes', 'routes'].filter((name) => typeof mod[name] === 'function')
    if (exported.length === 0) throw new Error('exports none of publicRoutes(), protectedRoutes() or routes()')
    return exported.map((name) => `${name}()`).join(', ')
  })
  await check(`schedule.${ext}`, async () => {
    const file = path.join(baseDir, 'app', `schedule.${ext}`)
    if (!(await pathExists(file))) return warn(`app/schedule.${ext} is missing (only needed for scheduled tasks)`)
    const mod = await import(pathToFileURL(file).href)
    if (typeof mod.schedule !== 'function') throw new Error('does not export a schedule() function')
    return 'schedule()'
  })
  await check('app folders', async () => {
    const missing = []
    for (const folder of APP_FOLDERS) {
      if (!(await pathExists(path.join(baseDir, 'app', folder)))) missing.push(folder)
    }
    if (missing.length) return warn(`no app/${missing.join(', app/')} yet (make:* commands create them)`)
    return `${APP_FOLDERS.length} present`
  })
  console.log()

  // ---- Settings: each value and where it came from ----
  if (config) {
    console.log('Settings')
    for (const [key, value] of settingRows(config)) {
      await check(key, async () => value)
    }
    console.log()
  }

  // ---- Database ----
  console.log('Database')
  let adapter = null
  await check('connection', async () => {
    adapter = await bootstrapDatabase()
    return config?.database?.driver ?? ''
  })

  const migrationsDir = path.join(baseDir, 'database', 'migrations')
  const migrationFiles = (await pathExists(migrationsDir))
    ? (await fs.readdir(migrationsDir)).filter((f) => f.endsWith(`.${ext}`)).sort()
    : []

  await check('duplicate migrations', async () => {
    const byName = new Map()
    for (const file of migrationFiles) {
      const name = file.replace(/^\d+_/, '')
      byName.set(name, [...(byName.get(name) ?? []), file])
    }
    const dupes = [...byName.values()].filter((files) => files.length > 1)
    if (dupes.length) {
      return warn(`${dupes.map((files) => files.join(' and ')).join('; ')} create the same thing`)
    }
    return 'none'
  })

  if (adapter) {
    await check('pending migrations', async () => {
      const ran = await adapter.all('SELECT * FROM migrations').catch(() => null)
      if (ran === null) return warn('no migrations table yet: run "tylix migrate"')
      const done = new Set(ran.map((r) => r.filename))
      const pending = migrationFiles.filter((f) => !done.has(f))
      if (pending.length === 0) return `none (${migrationFiles.length} applied)`
      const shown = pending.slice(0, 3).join(', ') + (pending.length > 3 ? ', …' : '')
      return warn(`${pending.length} pending (${shown}): run "tylix migrate"`)
    })
  }

  await check('models', async () => {
    const files = await walk(path.join(baseDir, 'app', 'models'), (name) => name.endsWith(`.${ext}`))
    const broken = []
    for (const file of files) {
      try {
        await import(pathToFileURL(file).href)
      } catch (err) {
        broken.push(`${rel(file)}: ${err.message.split('\n')[0]}`)
      }
    }
    if (broken.length) throw new Error(`${broken.length} failed to load: ${broken.join('; ')}`)
    return `${files.length} loaded`
  })
  await adapter?.close?.()
  console.log()

  // ---- Frontend ----
  const driver = config?.frontend?.driver ?? NATIVE_DRIVER
  console.log(`Frontend (${driver})`)
  if (driver === NATIVE_DRIVER) {
    await check('compiler', async () => {
      const { renderPageDocument } = await import('@tylix/compiler')
      await renderPageDocument('page Doctor\nstate\n  ok: true\ntemplate\n  <div>{{ ok }}</div>\n', {})
      return 'compiles a sample page'
    })
    await check('pages', async () => {
      const pages = await walk(path.join(baseDir, 'app', 'pages'), (name, full) =>
        name.endsWith('.tyx') && name !== '_layout.tyx' && !full.includes(`${path.sep}components${path.sep}`),
      )
      return `${pages.length} .tyx page(s)`
    })
  } else {
    const frontendDir = resolveViewsDir(baseDir)
    let adapter = null
    await check(FRONTEND_PACKAGES[driver], async () => {
      ;({ adapter } = await loadFrontendAdapter(baseDir, driver))
      return 'installed'
    })
    if (adapter) {
      await check('frontend packages', async () => {
        const missing = []
        for (const name of adapter.requires ?? []) {
          if (!(await resolveFromProject(baseDir, name).catch(() => null))) missing.push(name)
        }
        if (missing.length) throw new Error(`missing ${missing.join(', ')}: run "npm install ${missing.join(' ')}"`)
        return (adapter.requires ?? []).join(', ')
      })
      if (ts && adapter.typecheck) {
        await check('type checker', async () => {
          const bin = path.join(baseDir, 'node_modules', '.bin', adapter.typecheck.bin)
          if (!(await pathExists(bin))) return warn(`${adapter.typecheck.bin} is not installed, so "tylix build" skips the frontend typecheck`)
          return adapter.typecheck.bin
        })
      }
    }
    let html = null
    await check('index.html', async () => {
      html = await fs.readFile(path.join(frontendDir, 'index.html'), 'utf-8').catch(() => null)
      if (html === null) throw new Error('app/views/index.html is missing')
      return 'present'
    })
    if (config.frontend.ssr) {
      await check('SSR entry', async () => {
        const names = ['entry-server.tsx', 'entry-server.ts', 'entry-server.jsx', 'entry-server.js']
        for (const name of names) if (await pathExists(path.join(frontendDir, name))) return name
        throw new Error('frontend.ssr is on but app/views has no entry-server file')
      })
      if (html !== null) {
        await check('SSR outlet', async () => {
          if (!html.includes(SSR_OUTLET)) throw new Error(`index.html has no ${SSR_OUTLET} where rendered pages go`)
          return SSR_OUTLET
        })
      }
    }
    await check('route markers', async () => {
      const file = path.join(frontendDir, await findRouteFile(driver, ts, (f) => pathExists(path.join(frontendDir, f))))
      const source = await fs.readFile(file, 'utf-8').catch(() => null)
      if (source === null) return warn(`${rel(file)} not found, so make:page can't add routes`)
      if (!source.includes(ROUTES_MARKER)) return warn(`${rel(file)} has no "${ROUTES_MARKER}" marker; make:page will print routes to add by hand`)
      return `make:page adds routes to ${rel(file)}`
    })
    await check('production build', async () => {
      const client = await pathExists(path.join(baseDir, 'dist', 'client', 'index.html'))
      const server = await pathExists(path.join(baseDir, 'dist', 'server', 'entry-server.js'))
      if (!client || (config.frontend.ssr && !server)) {
        const message = 'not built yet: run "tylix build" before "tylix start"'
        if (production) throw new Error(message)
        return warn(message)
      }
      return config.frontend.ssr ? 'dist/client and dist/server' : 'dist/client'
    })
  }
  console.log()

  // ---- Summary ----
  const features = await discoverFeatures(baseDir).catch(() => [])
  const elapsed = Math.round(performance.now() - startedAt)
  console.log(`${features.length} feature(s) · checked in ${elapsed}ms`)
  const parts = [`${counts.ok} ok`]
  if (counts.warn) parts.push(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`)
  if (counts.fail) parts.push(`${counts.fail} failed`)
  console.log(
    counts.fail === 0
      ? `Healthy: ${parts.join(', ')}.`
      : `Needs attention: ${parts.join(', ')}. Fix the ✘ items above.`,
  )
  process.exitCode = counts.fail === 0 ? 0 : 1
}
