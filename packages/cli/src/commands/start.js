import {
  printBox,
  printChecklist,
  printLinkSection,
  loadEnv,
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

// Production server: no file watching, no hot reload, no dev-only
// routes, cached page preparation, generic error pages. Expects
// `tylix build` and `tylix migrate` to have run already.
export async function start({ port } = {}) {
  process.env.NODE_ENV = 'production'

  const baseDir = process.cwd()
  await loadEnv(baseDir)

  const listenPort = port ?? (Number(process.env.PORT) || 3000)

  let app
  try {
    app = await createApp(baseDir, { production: true })
  } catch (err) {
    console.error(`\n✘ Failed to start: ${err.message}\n`)
    process.exit(1)
  }

  const server = new Server(app.router, {
    notFoundHandler: app.notFoundHandler,
  })

  const httpServer = server.listen(listenPort, (actualPort = listenPort) => {
    console.log()
    printBox('Tylix Framework')
    console.log()
    printChecklist([
      `Environment  ${process.env.APP_ENV || 'production'}`,
      `Database     ${DRIVER_LABELS[app.config.database.driver] ?? app.config.database.driver}`,
      `Features     ${app.features.length}`,
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
    console.log(`\nReceived ${signal}, finishing open requests...`)

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