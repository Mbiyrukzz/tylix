import cluster from 'node:cluster'
import os from 'node:os'
import {
  printBox,
  printChecklist,
  printLinkSection,
  loadEnv,
  loadConfig,
  detectLanguage,
} from '@tylix/shared'
import { Server } from '@tylix/core'
import { createApp } from '../server/createApp.js'

const DRIVER_LABELS = {
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mongodb: 'MongoDB',
}

const SHUTDOWN_TIMEOUT_MS = 10_000
const RESTART_WINDOW_MS = 60_000

// How many processes to run: --workers, else WORKERS (config.server.workers).
function workerCount(flag, configured) {
  const value = flag ?? configured
  if (value === 'auto') return os.availableParallelism()
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1) throw new Error(`--workers must be a whole number above 0 or "auto", got "${value}".`)
  return count
}

// The primary process with --workers: runs the workers, which share the
// port (the operating system spreads connections between them), replaces
// any that crash, and stops them all gracefully on SIGTERM.
function runPrimary(count, config) {
  console.log(`\nStarting ${count} workers (one per process, sharing port ${config.server.port})...`)
  if (config.store.driver === 'memory') {
    console.warn(
      '⚠ STORE_DRIVER=memory: each worker keeps its own rate limits and cache. Use database (default) or redis to share them.',
    )
  }
  const crashes = []
  let stopping = false
  const fork = () => cluster.fork({ TYLIX_WORKERS: String(count) })
  for (let i = 0; i < count; i++) fork()

  cluster.on('exit', (worker, code, signal) => {
    if (stopping) {
      if (Object.keys(cluster.workers).length === 0) process.exit(0)
      return
    }
    const now = Date.now()
    crashes.push(now)
    while (crashes[0] < now - RESTART_WINDOW_MS) crashes.shift()
    if (crashes.length > count * 5) {
      console.error('✘ Workers keep crashing (more than 5 each in a minute); stopping. See the errors above.')
      process.exit(1)
    }
    console.error(`Worker ${worker.process.pid} stopped (${signal ?? `exit ${code}`}); starting a replacement.`)
    // Wait longer the more crashes there have been, up to 10 seconds.
    setTimeout(fork, Math.min(250 * 2 ** (crashes.length - 1), 10_000))
  })

  const shutdown = (signal) => {
    if (stopping) process.exit(1)
    stopping = true
    console.log(`\nReceived ${signal}, stopping the workers after their open requests...`)
    for (const worker of Object.values(cluster.workers)) worker.process.kill('SIGTERM')
    setTimeout(() => {
      console.error('Shutdown timed out, exiting.')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS + 5_000).unref()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal))
}

// Production server: no file watching, no hot reload, no dev-only
// routes, cached page preparation, generic error pages. Expects
// `tylix build` and `tylix migrate` to have run already.
export async function start({ port, workers } = {}) {
  process.env.NODE_ENV = 'production'

  const baseDir = process.cwd()
  await loadEnv(baseDir)

  if (cluster.isPrimary) {
    let count
    try {
      const config = await loadConfig(baseDir, await detectLanguage(baseDir))
      count = workerCount(workers, config.server.workers)
      if (count > 1) {
        if (port) config.server.port = port
        return runPrimary(count, config)
      }
    } catch (err) {
      console.error(`\n✘ Failed to start: ${err.message}\n`)
      process.exit(1)
    }
  }
  const workerTotal = Number(process.env.TYLIX_WORKERS) || 1
  // Workers print nothing but errors; the first one shows the banner.
  const showBanner = cluster.isPrimary || cluster.worker.id === 1

  let app
  try {
    app = await createApp(baseDir, { production: true })
  } catch (err) {
    console.error(`\n✘ Failed to start: ${err.message}\n`)
    process.exit(1)
  }
  const listenPort = port ?? app.config.server.port

  const settings = app.config.server
  const server = new Server(app.router, {
    notFoundHandler: app.notFoundHandler,
    trustProxy: settings.trustProxy,
    debug: app.config.app.debug,
    maxBodyBytes: settings.maxBodyBytes,
    // Workers must all use the shared port, never move to another.
    autoPort: cluster.isPrimary ? settings.autoPort : false,
    maxPortAttempts: settings.portAttempts,
    trustedOrigins: settings.trustedOrigins,
    appUrl: app.config.app.url,
    cspMode: settings.csp.mode,
    csp: settings.csp.policy,
    ...app.serverOptions,
  })

  const httpServer = server.listen(listenPort, (actualPort = listenPort) => {
    if (!showBanner) return
    console.log()
    printBox('Tylix Framework')
    console.log()
    printChecklist([
      `Environment  ${app.config.app.env}`,
      `Database     ${DRIVER_LABELS[app.config.database.driver] ?? app.config.database.driver}`,
      `Features     ${app.features.length}`,
      `Workers      ${workerTotal}${workerTotal > 1 ? ` (store: ${app.config.store.driver})` : ''}`,
      app.frontend.host
        ? `Frontend     ${app.frontend.label} (dist/client)`
        : `Pages        ${app.pageRoutes.length}`,
    ])
    printLinkSection('Listening on', `http://localhost:${actualPort}`)
    console.log()
  })

  // Stop accepting connections, let running requests finish, then exit.
  // A second signal, or the timeout, exits immediately.
  let closing = false
  const shutdown = (signal) => {
    if (closing) process.exit(1)
    closing = true
    if (cluster.isPrimary) console.log(`\nReceived ${signal}, finishing open requests...`)

    httpServer.close(() => process.exit(0))
    // Keep-alive connections with no request in flight would hold close() open.
    httpServer.closeIdleConnections?.()

    setTimeout(() => {
      console.error('Shutdown timed out, exiting.')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal))
  }
}