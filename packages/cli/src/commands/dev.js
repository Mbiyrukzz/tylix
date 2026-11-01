import fs from 'node:fs/promises'
import { watch as fsWatch } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import {
  printLogo,
  printStatus,
  printGroup,
  printRoute,
  printUrls,
  printDivider,
  loadEnv,
} from '@tylix/shared'
import { Server } from '@tylix/core'
import { watchDirectoryTree, createHmrChannel } from '../hotReload.js'
import { createApp } from '../server/createApp.js'
import { getTylixVersion } from '../utils/version.js'

const execFileAsync = promisify(execFile)

// Folders under app/ that only the browser cares about. A change here
// rebuilds Tailwind and reloads the page; it never restarts the server.
const FRONTEND_DIRS = ['pages', 'useApi']

// Files that don't need a server restart wherever they live under app/.
const FRONTEND_EXTENSIONS = ['.tyx', '.css']

// Project-root files that change how the server boots.
const RESTART_ROOT_FILES = new Set([
  '.env',
  'tylix.config.js',
  'tylix.config.ts',
])

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

async function resolveCompilerSrcDir(baseDir) {
  const pkgDir = path.join(baseDir, 'node_modules', '@tylix', 'compiler')
  const realPkgDir = await fs.realpath(pkgDir)
  return path.join(realPkgDir, 'src')
}

// Runs the project's own locally-installed tailwindcss CLI (from
// node_modules/.bin) rather than assuming a global install, since
// create-tylix scaffolds tailwindcss as a project dependency.
async function buildTailwindCss(baseDir) {
  const binPath = path.join(baseDir, 'node_modules', '.bin', 'tailwindcss')
  const inputPath = path.join(baseDir, 'app', 'tailwind-input.css')
  const outputPath = path.join(baseDir, 'public', 'tailwind.css')

  if (!(await pathExists(binPath)) || !(await pathExists(inputPath))) {
    return false // not a Tailwind project, skip silently
  }

  try {
    await execFileAsync(binPath, ['-i', inputPath, '-o', outputPath])
    return true
  } catch (err) {
    console.error('Tailwind build failed:', err.message)
    return false
  }
}

const DRIVER_LABELS = {
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mongodb: 'MongoDB',
}

function getNetworkUrl(port) {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        return `http://${a.address}:${port}`
      }
    }
  }
  return null
}

function printBanner({
  version,
  port,
  driver,
  featureCount,
  pageCount,
  featureRoutes,
  pageRoutes,
  authEnabled,
  readyMs,
}) {
  console.log()
  printLogo({ version })
  console.log()

  printStatus([
    ['Environment', 'development'],
    ['Database', DRIVER_LABELS[driver] ?? driver],
    ['Compiler', 'Ready'],
    ['ORM', 'Ready'],
    ['Features', String(featureCount)],
    ['Pages', String(pageCount)],
  ])

  if (pageRoutes.length > 0) {
    printGroup('Pages')
    printRoute('GET', '/')
    for (const route of pageRoutes) printRoute('GET', route)
  }

  if (featureRoutes.length > 0) {
    printGroup('Features')
    for (const { table, auth } of featureRoutes) {
      printRoute('GET', `/api/${table}`, auth ? '🔒 auth' : '')
      printRoute('POST', `/api/${table}`)
      printRoute('GET', `/api/${table}/:id`)
      printRoute('PUT', `/api/${table}/:id`)
      printRoute('DELETE', `/api/${table}/:id`)
    }
  }

  if (authEnabled) {
    printGroup('Auth')
    printRoute('POST', '/api/register')
    printRoute('POST', '/api/login')
    printRoute('POST', '/api/auth/refresh')
    printRoute('POST', '/api/auth/logout')
    printRoute('GET', '/api/auth/verify-email')
    printRoute('POST', '/api/auth/forgot-password')
    printRoute('POST', '/api/auth/reset-password')
    printRoute('GET', '/api/me', '🔒 auth')
  }

  console.log()
  printDivider()

  const urls = [['Local', `http://localhost:${port}`]]
  const network = getNetworkUrl(port)
  if (network) urls.push(['Network', network])
  if (authEnabled) {
    urls.push(['Login', `http://localhost:${port}/login`])
    urls.push(['Register', `http://localhost:${port}/register`])
  }
  printUrls(urls)

  console.log(`\n  Ready in ${readyMs}ms · watching for changes...\n`)
}

// True when a changed file only affects the browser, so it must not
// restart the server.
function isFrontendChange(baseDir, file) {
  if (FRONTEND_EXTENSIONS.includes(path.extname(file))) return true
  const relative = path.relative(path.join(baseDir, 'app'), file)
  const topFolder = relative.split(path.sep)[0]
  return FRONTEND_DIRS.includes(topFolder)
}

// Watches .env and tylix.config.* in the project root (the directory
// watcher skips dotfiles, so .env needs its own watcher).
function watchRootFiles(baseDir, onChange) {
  let timer = null
  try {
    const watcher = fsWatch(baseDir, (eventType, filename) => {
      if (!filename || !RESTART_ROOT_FILES.has(filename)) return
      clearTimeout(timer)
      timer = setTimeout(() => onChange(path.join(baseDir, filename)), 150)
    })
    return {
      close() {
        clearTimeout(timer)
        watcher.close()
      },
    }
  } catch (err) {
    console.warn(`Could not watch project root: ${err.message}`)
    return { close() {} }
  }
}

// Starts the real server in a child process and restarts it whenever
// backend files change. Node caches ES modules, so a restart is the only
// reliable way to pick up edited routes, services, controllers and models.
function runSupervisor({ port }) {
  const baseDir = process.cwd()
  const entry = process.argv[1]

  let child = null
  let restarting = false
  let pendingReason = null
  let shuttingDown = false

  function spawnChild(isRestart) {
    const env = {
      ...process.env,
      TYLIX_DEV_CHILD: '1',
      TYLIX_DEV_RESTARTED: isRestart ? '1' : '',
    }
    if (port !== undefined) env.TYLIX_DEV_PORT = String(port)

    const current = spawn(
      process.execPath,
      [...process.execArgv, entry, ...process.argv.slice(2)],
      { stdio: 'inherit', env },
    )
    child = current

    current.on('exit', (code, signal) => {
      if (child === current) child = null
      if (shuttingDown || restarting) return
      console.log(
        `\n  ✖ App exited (${signal ?? `code ${code}`}). Waiting for file changes to restart...\n`,
      )
    })
  }

  function stopChild() {
    return new Promise((resolve) => {
      const current = child
      if (!current || current.exitCode !== null || current.signalCode !== null) {
        return resolve()
      }
      const forceKill = setTimeout(() => current.kill('SIGKILL'), 3000)
      current.once('exit', () => {
        clearTimeout(forceKill)
        resolve()
      })
      current.kill('SIGTERM')
    })
  }

  async function restart(reason) {
    if (shuttingDown) return
    if (restarting) {
      pendingReason = reason
      return
    }
    restarting = true
    console.log(`\n  ↻ ${reason} changed, restarting...`)
    await stopChild()
    spawnChild(true)
    restarting = false

    if (pendingReason) {
      const next = pendingReason
      pendingReason = null
      restart(next)
    }
  }

  const appWatcher = watchDirectoryTree(path.join(baseDir, 'app'), (file) => {
    if (file && isFrontendChange(baseDir, file)) return
    if (file && file.endsWith('~')) return // editor backup files
    restart(file ? path.relative(baseDir, file) : 'a backend file')
  })

  const rootWatcher = watchRootFiles(baseDir, (file) => {
    restart(path.relative(baseDir, file))
  })

  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    appWatcher.close()
    rootWatcher.close()
    await stopChild()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  spawnChild(false)
}

// The actual dev server. Runs directly with TYLIX_DEV_RESTART=false, and
// as the supervised child process otherwise.
async function runServer({ port } = {}) {
  const startedAt = performance.now()
  const version = getTylixVersion()

  const baseDir = process.cwd()
  await loadEnv(baseDir)

  const underSupervisor = process.env.TYLIX_DEV_CHILD === '1'
  const wasRestarted = process.env.TYLIX_DEV_RESTARTED === '1'

  // Priority: --port flag, then PORT from .env, then 3000. This has to
  // run after loadEnv(), otherwise PORT in .env is never seen.
  port =
    port ??
    (Number(process.env.TYLIX_DEV_PORT) || undefined) ??
    (Number(process.env.PORT) || 3000)

  const hotReloadCompiler = process.env.TYLIX_HOT_RELOAD_COMPILER === 'true'

  await buildTailwindCss(baseDir)

  const app = await createApp(baseDir, { production: false, hotReloadCompiler })

  const hmr = createHmrChannel(app.router)

  // Under the supervisor, backend changes restart the whole process, so
  // this process only watches what the browser needs. Without it, the
  // backend folders are watched here for a browser reload only.
  const watchedFolders = underSupervisor
    ? FRONTEND_DIRS
    : [...FRONTEND_DIRS, 'controllers', 'models', 'validators', 'Features']

  const watchedDirs = watchedFolders.map((d) => path.join(baseDir, 'app', d))

  if (hotReloadCompiler) {
    watchedDirs.push(await resolveCompilerSrcDir(baseDir))
  }

  watchedDirs.forEach((dir) =>
    watchDirectoryTree(dir, async () => {
      await buildTailwindCss(baseDir)
      hmr.notify()
    }),
  )

  const server = new Server(app.router, {
    notFoundHandler: app.notFoundHandler,
  })
  server.listen(port, () => {
    const readyMs = Math.round(performance.now() - startedAt)

    if (wasRestarted) {
      console.log(`  ✔ Server restarted in ${readyMs}ms · http://localhost:${port}\n`)
      return
    }

    printBanner({
      version,
      readyMs,
      port,
      driver: app.config.database.driver,
      featureCount: app.features.length,
      pageCount: app.pageRoutes.length,
      featureRoutes: app.features.map((f) => ({
        table: f.manifest.table,
        auth: f.manifest.auth,
      })),
      pageRoutes: app.pageRoutes,
      authEnabled: app.authEnabled,
    })
  })
}

export async function dev({ port } = {}) {
  const isChild = process.env.TYLIX_DEV_CHILD === '1'
  const restartEnabled = process.env.TYLIX_DEV_RESTART !== 'false'

  if (!isChild && restartEnabled) {
    return runSupervisor({ port })
  }
  return runServer({ port })
}