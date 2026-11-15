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
  exists as pathExists,
  VIEWS_DIR,
  LEGACY_VIEWS_DIR,
  resolveViewsDir,
} from '@tylix/shared'
import { Server } from '@tylix/core'
import {
  watchDirectoryTree,
  createHmrChannel,
  createSaveTracker,
} from '../hotReload.js'
import { createApp } from '../server/createApp.js'
import { writeRouteClient } from './routesTypes.js'
import { getTylixVersion } from '../utils/version.js'
import { freePort } from '../frontend/frontendHost.js'

const execFileAsync = promisify(execFile)

// Folders under app/ that only the browser cares about. A change here
// rebuilds Tailwind and reloads the page; it never restarts the server.
const FRONTEND_DIRS = ['pages', 'useApi']

// app/views holds a hosted frontend (React, ...). Vite hot-reloads it,
// so a change there never restarts the server either.
// (app/frontend in projects made before 2.0.)
const HOSTED_FRONTEND_DIRS = [VIEWS_DIR, LEGACY_VIEWS_DIR]

// Files that don't need a server restart wherever they live under app/.
const FRONTEND_EXTENSIONS = ['.tyx', '.css']

// The page shell, read again on every page render (app/index.html,
// app/head.html). Other .html files under app/ (mail templates, say) are
// backend files.
const FRONTEND_ROOT_FILES = ['index.html', 'head.html']

// Project-root files that change how the server boots, or how its
// Tailwind/PostCSS build runs (that build only happens at startup and on
// page saves, so a config edit needs a fresh start).
const RESTART_ROOT_FILES = new Set([
  '.env',
  'tylix.config.js',
  'tylix.config.ts',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
])


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
  mariadb: 'MariaDB',
  cockroach: 'CockroachDB',
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

// Prints one titled group of recorded routes. A lock goes on every
// guarded route, not just the first of a set.
function printRouteGroup(title, routes) {
  if (routes.length === 0) return
  printGroup(title)
  for (const route of routes) {
    printRoute(route.method, route.pattern, route.auth ? '🔒 auth' : '')
  }
}

function printBanner({
  frontendLabel,
  hosted,
  version,
  port,
  environment,
  driver,
  featureCount,
  pageCount,
  routes,
  pageRoutes,
  authEnabled,
  readyMs,
}) {
  console.log()
  printLogo({ version })
  console.log()

  printStatus([
    ['Environment', environment],
    ['Database', DRIVER_LABELS[driver] ?? driver],
    hosted ? ['Frontend', `${frontendLabel} (Vite)`] : ['Compiler', 'Ready'],
    ['ORM', 'Ready'],
    ['Features', String(featureCount)],
    ...(hosted ? [] : [['Pages', String(pageCount)]]),
  ])

  if (hosted) {
    printGroup('Pages')
    printRoute('GET', '/*', `${frontendLabel} app`)
  } else if (pageRoutes.length > 0) {
    printGroup('Pages')
    printRoute('GET', '/')
    for (const route of pageRoutes) printRoute('GET', route)
  }

  // Routes come from what was actually registered:
  //   feature  CRUD routes mounted from a feature manifest
  //   routes   app/routes/*.ts, web.ts and make:api files
  //   auth     the built-in login/register routes
  //   plugin   routes added by plugins
  printRouteGroup(
    'Features',
    routes.filter((r) => r.source === 'feature'),
  )
  printRouteGroup(
    'API',
    routes.filter((r) => r.source === 'routes'),
  )
  printRouteGroup(
    'Auth',
    routes.filter((r) => r.source === 'auth'),
  )
  printRouteGroup(
    'Plugins',
    routes.filter((r) => r.source === 'plugin'),
  )

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
export function isFrontendChange(baseDir, file) {
  if (FRONTEND_EXTENSIONS.includes(path.extname(file))) return true
  const relative = path.relative(path.join(baseDir, 'app'), file)
  if (FRONTEND_ROOT_FILES.includes(relative)) return true
  const topFolder = relative.split(path.sep)[0]
  return FRONTEND_DIRS.includes(topFolder) || HOSTED_FRONTEND_DIRS.includes(topFolder)
}

// Page routes are registered once, when the server starts, from the files
// in app/pages. Editing a page needs no restart (it is read again on every
// request), but a page that was added or deleted changes the routes.
// Components, layouts (_layout.tyx) and not-found pages (_not-found.tyx)
// are never routes themselves.
export function isPageRouteChange(baseDir, { file, kind }) {
  if (kind !== 'created' && kind !== 'removed') return false
  if (path.extname(file) !== '.tyx') return false
  const relative = path.relative(path.join(baseDir, 'app', 'pages'), file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false
  const parts = relative.split(path.sep)
  if (parts[0] === 'components') return false
  return !path.basename(file).startsWith('_')
}

// Watches .env and tylix.config.* in the project root (the directory
// watcher skips dotfiles, so .env needs its own watcher). Saves are
// recorded on the shared tracker so they show up in the terminal too.
function watchRootFiles(baseDir, tracker, onChange) {
  let timer = null
  try {
    const watcher = fsWatch(baseDir, (eventType, filename) => {
      if (!filename || !RESTART_ROOT_FILES.has(filename)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const file = path.join(baseDir, filename)
        tracker.record('saved', file)
        onChange(file)
      }, 150)
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
//
// The supervisor owns the save tracker and prints every save, so counts
// keep growing across child restarts. The child runs with logging off.
async function runSupervisor({ port }) {
  const baseDir = process.cwd()
  // One Vite HMR port for the whole session (hosted frontends). Every
  // restarted child binds it again, so an open tab's Vite client sees the
  // server come back and reloads the page with the new backend.
  const hmrPort = await freePort()
  const entry = process.argv[1]
  const tracker = createSaveTracker({ rootDir: baseDir })

  let child = null
  let restarting = false
  let pendingReason = null
  let shuttingDown = false

  function spawnChild(isRestart) {
    const env = {
      ...process.env,
      TYLIX_DEV_CHILD: '1',
      TYLIX_DEV_RESTARTED: isRestart ? '1' : '',
      TYLIX_DEV_HMR_PORT: String(hmrPort),
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
    console.log(`  ↻ ${reason} changed, restarting...`)
    await stopChild()
    spawnChild(true)
    restarting = false

    if (pendingReason) {
      const next = pendingReason
      pendingReason = null
      restart(next)
    }
  }

  // Every save under app/ is logged here. A backend file in the batch, or
  // a page that was added or removed (new routes), triggers a restart.
  // All files are checked, not just the last one, so a controller saved
  // together with a page isn't missed.
  const appWatcher = watchDirectoryTree(
    path.join(baseDir, 'app'),
    (_last, files, events = []) => {
      const backendFile = files.find((f) => !isFrontendChange(baseDir, f))
      const routeChange = events.find((e) => isPageRouteChange(baseDir, e))
      const reason = backendFile ?? routeChange?.file
      if (!reason) return
      restart(path.relative(baseDir, reason))
    },
    { tracker },
  )

  const rootWatcher = watchRootFiles(baseDir, tracker, (file) => {
    restart(path.relative(baseDir, file))
  })

  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    appWatcher.close()
    rootWatcher.close()
    await stopChild()
    tracker.summary()
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

  const hotReloadCompiler = process.env.TYLIX_HOT_RELOAD_COMPILER === 'true'

  const app = await createApp(baseDir, { production: false, hotReloadCompiler })

  // Keep the typed API client in step with the routes (typedRoutes: false
  // in tylix.config turns it off). Written only when it changed.
  if (app.config.typedRoutes !== false) {
    try {
      const { changed } = await writeRouteClient(baseDir, app)
      if (changed.length && !wasRestarted) console.log(`  Typed API client updated: ${changed.join(', ')}`)
    } catch (err) {
      console.warn(`⚠ Could not write the typed API client: ${err.message}`)
    }
  }

  // Priority: --port flag, the port a restarted child keeps, then PORT
  // (config.server.port: .env, tylix.config, default 3000).
  port = port ?? (Number(process.env.TYLIX_DEV_PORT) || undefined) ?? app.config.server.port

  // Shown in the startup banner. "local" etc. come from APP_ENV in .env.
  const environment = app.config.app.env
  const hostedFrontend = app.frontend.host

  // A hosted frontend runs Tailwind through Vite's PostCSS, so the
  // Tailwind CLI build is only for native .tyx pages.
  if (!hostedFrontend) await buildTailwindCss(baseDir)

  const hmr = createHmrChannel(app.router)

  // Under the supervisor, backend changes restart the whole process, so
  // this process only watches what the browser needs. Without it, the
  // backend folders are watched here for a browser reload only.
  //
  // A hosted frontend's own files are watched by Vite; only the backend
  // folders matter here, and only without the supervisor.
  //
  // Native pages: all of app/ is watched, because what a page shows can
  // come from anywhere in it (app/loading.tyx, app/index.html,
  // app/tailwind-input.css, components, useApi helpers), not only from
  // app/pages. Under the supervisor only frontend files count here; the
  // supervisor restarts the process for the rest.
  const appDir = path.join(baseDir, 'app')
  const watchedDirs = []
  if (!hostedFrontend || !underSupervisor) watchedDirs.push(appDir)

  if (hotReloadCompiler) {
    watchedDirs.push(await resolveCompilerSrcDir(baseDir))
  }

  // Under the supervisor, the supervisor already prints every save, so stay
  // silent here. Standalone, all watchers share one tracker so the running
  // total is correct across folders.
  const tracker = createSaveTracker({ rootDir: baseDir, log: !underSupervisor })

  const hostedDir = resolveViewsDir(baseDir)
  const relevant = (file) => {
    // Vite watches and hot-reloads the hosted frontend itself.
    if (hostedFrontend && (file === hostedDir || file.startsWith(hostedDir + path.sep))) return false
    if (!underSupervisor || !file.startsWith(appDir + path.sep)) return true
    return isFrontendChange(baseDir, file)
  }

  const watchers = watchedDirs.map((dir) =>
    watchDirectoryTree(
      dir,
      async (_last, changed, events = []) => {
        // A page added or removed: the supervisor restarts the server for
        // the new routes, and the browser reloads when it reconnects.
        // Reloading now would only show the old server's 404.
        if (underSupervisor && events.some((e) => isPageRouteChange(baseDir, e))) return
        const files = changed.filter(relevant)
        if (files.length === 0) return
        if (hostedFrontend) {
          hostedFrontend.reload()
          return
        }
        await buildTailwindCss(baseDir)
        hmr.notify(files.map((f) => path.relative(baseDir, f)))
      },
      { tracker },
    ),
  )

  if (!underSupervisor) {
    process.on('SIGINT', async () => {
      watchers.forEach((w) => w.close())
      hmr.close()
      await app.close().catch(() => {})
      tracker.summary()
      process.exit(0)
    })
  } else {
    // The supervisor stops this child with SIGTERM on every restart. Close
    // Vite first so its HMR port is free for the next child.
    process.on('SIGTERM', async () => {
      await app.close().catch(() => {})
      process.exit(0)
    })
  }

  const settings = app.config.server
  const server = new Server(app.router, {
    notFoundHandler: app.notFoundHandler,
    trustProxy: settings.trustProxy,
    debug: app.config.app.debug,
    maxBodyBytes: settings.maxBodyBytes,
    autoPort: settings.autoPort,
    maxPortAttempts: settings.portAttempts,
    trustedOrigins: settings.trustedOrigins,
    appUrl: app.config.app.url,
    cspMode: settings.csp.mode,
    csp: settings.csp.policy,
    ...app.serverOptions,
  })

  // `actualPort` is the port that was really bound. It differs from
  // `port` when that one was taken and AUTO_PORT moved us to the next.
  server.listen(port, (actualPort = port) => {
    const readyMs = Math.round(performance.now() - startedAt)

    if (wasRestarted) {
      console.log(
        `  ✔ Server restarted in ${readyMs}ms · http://localhost:${actualPort}\n`,
      )
      return
    }

    printBanner({
      version,
      readyMs,
      port: actualPort,
      environment,
      driver: app.config.database.driver,
      featureCount: app.features.length,
      pageCount: app.pageRoutes.length,
      routes: app.routes,
      pageRoutes: app.pageRoutes,
      authEnabled: app.authEnabled,
      hosted: Boolean(hostedFrontend),
      frontendLabel: app.frontend.label,
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