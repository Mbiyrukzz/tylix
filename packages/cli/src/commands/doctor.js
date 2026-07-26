import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, loadEnv } from '@tylix/shared'
import { discoverFeatures } from '@tylix/core'
import { bootstrapDatabase } from '../bootstrap.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function printSectionHeader(title) {
  console.log(title)
}

async function check(label, fn) {
  try {
    const detail = await fn()
    console.log(`✔ ${label.padEnd(18)}${detail || ''}`)
    return { ok: true, detail }
  } catch (err) {
    console.log(`✘ ${label.padEnd(18)}${err.message}`)
    return { ok: false, detail: null }
  }
}

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

// Mirrors dev.js's walkPagesDir -- kept local so doctor doesn't need
// to import an internal dev-command helper.
async function walkPagesDir(dir) {
  const exists = await pathExists(dir)
  if (!exists) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'components') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkPagesDir(fullPath)))
    } else if (entry.name.endsWith('.tyx') && entry.name !== '_layout.tyx') {
      files.push(fullPath)
    }
  }
  return files
}

export async function doctor() {
  const baseDir = process.cwd()
  const startedAt = performance.now()
  const results = []

  console.log('Tylix Doctor')
  console.log('─'.repeat(28))

  // ---- Environment ----
  printSectionHeader('Environment')
  results.push(
    await check('Node.js', async () => process.version.replace(/^v/, '')),
  )
  results.push(
    await check('npm', async () => {
      const { stdout } = await execFileAsync('npm', ['--version'])
      return stdout.trim()
    }),
  )
  results.push(
    await check('Tylix', async () => {
      const cliPkgPath = path.resolve(__dirname, '..', '..', 'package.json')
      const pkg = JSON.parse(await fs.readFile(cliPkgPath, 'utf-8'))
      return pkg.version
    }),
  )
  console.log()

  // ---- Project ----
  printSectionHeader('Project')
  results.push(
    await check('tylix.config.js', async () => {
      await loadConfig(baseDir)
    }),
  )

  results.push(
    await check('.env', async () => {
      const exists = await pathExists(path.join(baseDir, '.env'))
      if (!exists) throw new Error('missing — add one or re-run create-tylix')
    }),
  )
  await loadEnv(baseDir)

  // Shallow: confirms app/routes/web.js exists and exports an async
  // routes() function. Does not verify the routes it registers work.
  results.push(
    await check('routes', async () => {
      const routesPath = path.join(baseDir, 'app', 'routes', 'web.js')
      if (!(await pathExists(routesPath))) {
        throw new Error('app/routes/web.js missing')
      }
      const mod = await import(pathToFileURL(routesPath).href)
      if (typeof mod.routes !== 'function') {
        throw new Error('does not export an async "routes" function')
      }
    }),
  )

  // Shallow: confirms app/schedule.js exists and exports schedule().
  // Does not verify any scheduled jobs actually run.
  results.push(
    await check('scheduler', async () => {
      const schedulePath = path.join(baseDir, 'app', 'schedule.js')
      if (!(await pathExists(schedulePath))) {
        throw new Error('app/schedule.js missing')
      }
      const mod = await import(pathToFileURL(schedulePath).href)
      if (typeof mod.schedule !== 'function') {
        throw new Error('does not export an async "schedule" function')
      }
    }),
  )

  // Shallow: app/middleware/ is scaffolded as an empty directory with
  // no default file or export contract, so existence is all there is
  // to check today.
  results.push(
    await check('middleware', async () => {
      const middlewareDir = path.join(baseDir, 'app', 'middleware')
      if (!(await pathExists(middlewareDir))) {
        throw new Error('app/middleware/ missing')
      }
    }),
  )
  console.log()

  // ---- Database ----
  printSectionHeader('Database')
  let adapter = null
  const dbConnected = await check('database connects', async () => {
    adapter = await bootstrapDatabase()
  })
  results.push(dbConnected)

  if (dbConnected.ok && adapter) {
    results.push(
      await check('pending migrations', async () => {
        const migrationsDir = path.join(baseDir, 'database', 'migrations')
        if (!(await pathExists(migrationsDir))) return 'no migrations directory'

        const files = (await fs.readdir(migrationsDir)).filter((f) =>
          f.endsWith('.js'),
        )
        const ranRows = await adapter
          .all('SELECT * FROM migrations')
          .catch(() => null)
        if (ranRows === null) {
          throw new Error(
            'no migrations table — run "tylix migrate" at least once',
          )
        }
        const ranSet = new Set(ranRows.map((r) => r.filename))
        const pending = files.filter((f) => !ranSet.has(f))
        return pending.length > 0 ? `${pending.length} pending` : '0 pending'
      }),
    )

    // Shallow: imports every file in app/models/ and confirms it
    // doesn't throw. Does not verify models against actual DB schema.
    results.push(
      await check('models loaded', async () => {
        const modelsDir = path.join(baseDir, 'app', 'models')
        if (!(await pathExists(modelsDir))) return '0 models'
        const files = (await fs.readdir(modelsDir)).filter((f) =>
          f.endsWith('.js'),
        )
        for (const file of files) {
          await import(pathToFileURL(path.join(modelsDir, file)).href)
        }
        return `${files.length} model(s)`
      }),
    )

    await adapter.close()
  }
  console.log()

  // ---- Compiler ----
  printSectionHeader('Compiler')
  // Deep: actually compiles a throwaway .tyx source string end to end
  // (lexer -> parser -> codegen) rather than just checking the
  // package resolves.
  results.push(
    await check('parser', async () => {
      const { renderPageDocument } = await import('@tylix/compiler')
      const sample = `page Doctor\nstate\n  ok: true\ntemplate\n  <div>{{ ok }}</div>\n`
      renderPageDocument(sample, {})
    }),
  )

  // Shallow: confirms the runtime source files @tylix/compiler embeds
  // into every generated page (reactive.js, etc.) exist and are
  // readable. Does not execute the runtime in a real DOM.
  results.push(
    await check('runtime', async () => {
      const compilerEntryPath = fileURLToPath(
        await import.meta.resolve('@tylix/compiler'),
      )
      const compilerSrcDir = path.dirname(compilerEntryPath) // .../compiler/src
      const runtimeFile = path.join(compilerSrcDir, 'runtime', 'reactive.js')
      if (!(await pathExists(runtimeFile))) {
        throw new Error(
          'runtime/reactive.js not found alongside @tylix/compiler',
        )
      }
    }),
  )

  // Shallow: confirms the HMR SSE endpoint helper resolves. Does not
  // open a real connection or verify a browser receives a reload
  // message.
  results.push(
    await check('HMR', async () => {
      await import('../hotReload.js')
    }),
  )
  console.log()

  // ---- Performance ----
  printSectionHeader('Performance')
  const pagesDir = path.join(baseDir, 'app', 'pages')
  const pageCount = (await walkPagesDir(pagesDir)).length
  const features = await discoverFeatures(baseDir)

  const elapsedMs = Math.round(performance.now() - startedAt)
  console.log(`✔ ${'startup'.padEnd(18)}${elapsedMs}ms`)
  console.log(`✔ ${'pages'.padEnd(18)}${pageCount}`)
  console.log(`✔ ${'features'.padEnd(18)}${features.length}`)
  console.log()

  const failures = results.filter((r) => !r.ok).length
  console.log(
    failures === 0
      ? 'Everything looks healthy.'
      : `${failures} check${failures === 1 ? '' : 's'} failed — see above.`,
  )

  process.exitCode = failures === 0 ? 0 : 1
}
