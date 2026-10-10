import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  printBox,
  printChecklist,
  printLinkSection,
  loadEnv,
} from '@tylix/shared'
import { Server } from '@tylix/core'
import { watchDirectoryTree, createHmrChannel } from '../hotReload.js'
import { createApp } from '../server/createApp.js'

const execFileAsync = promisify(execFile)

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

function printBanner({
  port,
  driver,
  featureCount,
  pageCount,
  featureRoutes,
  pageRoutes,
  authEnabled,
}) {
  console.log()
  printBox('Tylix Framework v0.1')
  console.log()
  printChecklist([
    `Environment  development`,
    `Database     ${DRIVER_LABELS[driver] ?? driver}`,
    `Compiler     Ready`,
    `ORM          Ready`,
    `Features     ${featureCount}`,
    `Pages        ${pageCount}`,
  ])

  if (pageRoutes.length > 0 || featureRoutes.length > 0) {
    console.log('\nRoutes')
    if (pageRoutes.length > 0) console.log(`  GET   /`)
    for (const route of pageRoutes) console.log(`  GET   ${route}`)
    for (const route of featureRoutes) {
      const authNote = route.auth ? '  (auth required)' : ''
      console.log(`  GET     /api/${route.table}${authNote}`)
      console.log(`  POST    /api/${route.table}`)
      console.log(`  GET     /api/${route.table}/:id`)
      console.log(`  PUT     /api/${route.table}/:id`)
      console.log(`  DELETE  /api/${route.table}/:id`)
    }
  }

  printLinkSection('Your app is running at', `http://localhost:${port}`)

  if (authEnabled) {
    printLinkSection('Login', `http://localhost:${port}/login`)
    printLinkSection('Register', `http://localhost:${port}/register`)
    console.log('\nAPI')
    console.log('POST /api/register')
    console.log('POST /api/login')
    console.log('POST /api/auth/refresh')
    console.log('POST /api/auth/logout')
    console.log('GET  /api/auth/verify-email')
    console.log('POST /api/auth/forgot-password')
    console.log('POST /api/auth/reset-password')
    console.log('GET  /api/me')
  }

  console.log('\nWatching...\n')
}

export async function dev({ port = 3000 } = {}) {
  const baseDir = process.cwd()
  await loadEnv(baseDir)

  const hotReloadCompiler = process.env.TYLIX_HOT_RELOAD_COMPILER === 'true'

  await buildTailwindCss(baseDir)

  const app = await createApp(baseDir, { production: false, hotReloadCompiler })

  const hmr = createHmrChannel(app.router)
  const watchedDirs = [
    'pages',
    'controllers',
    'models',
    'validators',
    'Features',
  ].map((d) => path.join(baseDir, 'app', d))

  if (hotReloadCompiler) {
    watchedDirs.push(await resolveCompilerSrcDir(baseDir))
  }

  watchedDirs.map((dir) =>
    watchDirectoryTree(dir, async () => {
      await buildTailwindCss(baseDir)
      hmr.notify()
    }),
  )

  const server = new Server(app.router, {
    notFoundHandler: app.notFoundHandler,
  })
  server.listen(port, () => {
    printBanner({
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