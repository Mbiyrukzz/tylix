import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, loadEnv, detectLanguage } from '@tylix/shared'
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
  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'

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

  results.push(
    await check('routes', async () => {
      const routesPath = path.join(baseDir, 'app', 'routes', `web.${ext}`)
      if (!(await pathExists(routesPath))) {
        throw new Error(`app/routes/web.${ext} missing`)
      }
      const mod = await import(pathToFileURL(routesPath).href)
      if (typeof mod.routes !== 'function') {
        throw new Error('does not export an async "routes" function')
      }
    }),
  )

  results.push(
    await check('scheduler', async () => {
      const schedulePath = path.join(baseDir, 'app', `schedule.${ext}`)
      if (!(await pathExists(schedulePath))) {
        throw new Error(`app/schedule.${ext} missing`)
      }
      const mod = await import(pathToFileURL(schedulePath).href)
      if (typeof mod.schedule !== 'function') {
        throw new Error('does not export an async "schedule" function')
      }
    }),
  )

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
          f.endsWith(`.${ext}`),
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

    results.push(
      await check('models loaded', async () => {
        const modelsDir = path.join(baseDir, 'app', 'models')
        if (!(await pathExists(modelsDir))) return '0 models'
        const files = (await fs.readdir(modelsDir)).filter((f) =>
          f.endsWith(`.${ext}`),
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
  results.push(
    await check('parser', async () => {
      const { renderPageDocument } = await import('@tylix/compiler')
      const sample = `page Doctor\nstate\n  ok: true\ntemplate\n  <div>{{ ok }}</div>\n`
      renderPageDocument(sample, {})
    }),
  )

  results.push(
    await check('runtime', async () => {
      const compilerEntryPath = fileURLToPath(
        await import.meta.resolve('@tylix/compiler'),
      )
      const compilerSrcDir = path.dirname(compilerEntryPath)
      const runtimeFile = path.join(compilerSrcDir, 'runtime', 'reactive.js')
      if (!(await pathExists(runtimeFile))) {
        throw new Error(
          'runtime/reactive.js not found alongside @tylix/compiler',
        )
      }
    }),
  )

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
