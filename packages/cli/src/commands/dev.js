import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
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

export async function dev({ port } = {}) {
  const startedAt = performance.now()
  const version = getTylixVersion()

  const baseDir = process.cwd()
  await loadEnv(baseDir)

  // Priority: --port flag, then PORT from .env, then 3000. This has to
  // run after loadEnv(), otherwise PORT in .env is never seen.
  port = port ?? (Number(process.env.PORT) || 3000)

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
    printBanner({
      version,
      readyMs: Math.round(performance.now() - startedAt),
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