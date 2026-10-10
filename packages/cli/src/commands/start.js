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

  server.listen(listenPort, () => {
    console.log()
    printBox('Tylix Framework')
    console.log()
    printChecklist([
      `Environment  production`,
      `Database     ${DRIVER_LABELS[app.config.database.driver] ?? app.config.database.driver}`,
      `Features     ${app.features.length}`,
      `Pages        ${app.pageRoutes.length}`,
    ])
    printLinkSection('Listening on', `http://localhost:${listenPort}`)
    console.log()
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\nReceived ${signal}, shutting down.`)
      process.exit(0)
    })
  }
}