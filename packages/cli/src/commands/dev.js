import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  printBox,
  printChecklist,
  printLinkSection,
} from '../../../create-tylix/src/utils/banner.js'

const execFileAsync = promisify(execFile)
import {
  Router,
  Server,
  discoverFeatures,
  registerFeatureRoutes,
  requireAuth,
} from '@tylix/core'
import { renderPageDocument } from '@tylix/compiler'
import {
  watchDirectoryTree,
  createHmrChannel,
  HMR_CLIENT_SCRIPT,
} from '../hotReload.js'

// Runs the project's own locally-installed tailwindcss CLI (from
// node_modules/.bin) rather than assuming a global install, since
// create-tylix scaffolds tailwindcss as a project dependency.
async function buildTailwindCss(baseDir) {
  const binPath = path.join(baseDir, 'node_modules', '.bin', 'tailwindcss')
  const inputPath = path.join(baseDir, 'app', 'tailwind-input.css')
  const outputPath = path.join(baseDir, 'public', 'tailwind.css')

  const binExists = await fs
    .access(binPath)
    .then(() => true)
    .catch(() => false)
  const inputExists = await fs
    .access(inputPath)
    .then(() => true)
    .catch(() => false)
  if (!binExists || !inputExists) return false // not a Tailwind project, skip silently

  try {
    await execFileAsync(binPath, ['-i', inputPath, '-o', outputPath])
    return true
  } catch (err) {
    console.error('Tailwind build failed:', err.message)
    return false
  }
}

const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// Serves static assets from public/ (Tailwind's compiled CSS, logo
// images, favicons). This is a fallback in the Server's 404 handler
// path rather than a router registration, since static filenames
// aren't known ahead of time the way feature/page routes are.
async function serveStaticAsset(req, res, baseDir) {
  const publicDir = path.join(baseDir, 'public')
  const urlPath = req.url.split('?')[0]
  const filePath = path.join(publicDir, decodeURIComponent(urlPath))

  if (!filePath.startsWith(publicDir)) return false // path traversal guard

  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return false

  const stat = await fs.stat(filePath)
  if (!stat.isFile()) return false

  const ext = path.extname(filePath)
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
  res.end(await fs.readFile(filePath))
  return true
}
import { loadConfig } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'

async function registerAuthRoutes(router, baseDir, authConfig) {
  const controllerPath = path.join(
    baseDir,
    'app',
    'controllers',
    'AuthController.js',
  )
  const exists = await fs
    .access(controllerPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return false

  const { AuthController } = await import(pathToFileURL(controllerPath).href)
  const controller = new AuthController({
    secret: authConfig.secret,
    tokenExpiresInSeconds: authConfig.tokenExpiresInSeconds,
  })

  router.post('/api/register', (req, res) => controller.register(req, res))
  router.post('/api/login', (req, res) => controller.login(req, res))
  router.get(
    '/api/me',
    requireAuth((req, res) => controller.me(req, res), authConfig.secret),
  )

  return true
}

function injectHmrScript(html) {
  return html.replace('</body>', `${HMR_CLIENT_SCRIPT}</body>`)
}
async function loadLayout(pagesDir) {
  const layoutPath = path.join(pagesDir, '_layout.tyx')
  const exists = await fs
    .access(layoutPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return null
  return fs.readFile(layoutPath, 'utf-8')
}

async function walkPagesDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkPagesDir(fullPath)))
    } else if (entry.name.endsWith('.tyx') && entry.name !== '_layout.tyx') {
      files.push(fullPath)
    }
  }
  return files
}

// posts/[id].tyx        -> /posts/:id
// posts/Index.tyx        -> /posts
// users/[id]/Profile.tyx -> /users/:id/profile
// Home.tyx                -> /home (root "/" is handled separately below)
function filePathToRoute(pagesDir, filePath) {
  const relative = path.relative(pagesDir, filePath).replace(/\.tyx$/, '')
  const segments = relative.split(path.sep)

  const routeSegments = segments
    .map((segment, i) => {
      const isLast = i === segments.length - 1
      if (isLast && segment === 'Index') return null

      const dynamicMatch = /^\[(.+)\]$/.exec(segment)
      if (dynamicMatch) return `:${dynamicMatch[1]}`

      return segment.toLowerCase()
    })
    .filter((segment) => segment !== null)

  const routePath = '/' + routeSegments.join('/')
  return routePath.length > 1 ? routePath.replace(/\/$/, '') : routePath
}

// Registration order matters for Router.match() (first match wins), so
// routes with fewer dynamic (":param") segments must register before
// routes with more -- otherwise a dynamic segment like :id can shadow
// a real static route (e.g. /posts/create being wrongly captured by
// /posts/:id) purely based on filesystem read order.
function bySpecificity(a, b) {
  const dynamicCount = (routePath) => (routePath.match(/:/g) || []).length
  return dynamicCount(a.routePath) - dynamicCount(b.routePath)
}

// Walks up from the page's own directory toward pagesDir looking for
// the nearest _layout.tyx. Closest layout wins -- layouts do not
// compose/nest, so a page under app/pages/admin/ uses only
// app/pages/admin/_layout.tyx if present, never both that and the
// root app/pages/_layout.tyx together.
async function findLayoutForFile(pagesDir, filePath) {
  let dir = path.dirname(filePath)
  while (true) {
    const layoutPath = path.join(dir, '_layout.tyx')
    const exists = await fs
      .access(layoutPath)
      .then(() => true)
      .catch(() => false)
    if (exists) return fs.readFile(layoutPath, 'utf-8')
    if (dir === pagesDir) return null
    dir = path.dirname(dir)
  }
}

async function registerPageRoutes(router, baseDir) {
  const pagesDir = path.join(baseDir, 'app', 'pages')
  const exists = await fs
    .access(pagesDir)
    .then(() => true)
    .catch(() => false)
  if (!exists) return []

  const files = await walkPagesDir(pagesDir)

  async function renderFile(filePath, params = {}) {
    const source = await fs.readFile(filePath, 'utf-8')
    const layout = await findLayoutForFile(pagesDir, filePath)
    return injectHmrScript(
      renderPageDocument(source, {}, { layout, props: params }),
    )
  }

  const entries = files
    .map((filePath) => ({
      filePath,
      routePath: filePathToRoute(pagesDir, filePath),
    }))
    .sort(bySpecificity)

  const registered = []
  for (const { filePath, routePath } of entries) {
    router.get(routePath, async (req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await renderFile(filePath, req.params))
    })
    registered.push(routePath)
  }

  const homeFile = path.join(pagesDir, 'Home.tyx')
  if (files.includes(homeFile)) {
    router.get('/', async (req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await renderFile(homeFile, req.params))
    })
  }

  return registered
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
      console.log(`  GET     /api/${route.table}`)
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
    console.log('GET  /api/me')
  }

  console.log('\nWatching...\n')
}

export async function dev({ port = 3000 } = {}) {
  const baseDir = process.cwd()
  const config = await loadConfig(baseDir)

  await bootstrapDatabase()

  // Build Tailwind's CSS once before the server starts, so the very
  // first page load has real compiled styles rather than a 404.
  await buildTailwindCss(baseDir)

  const features = await discoverFeatures(baseDir)
  const router = new Router()
  registerFeatureRoutes(router, features)

  router.get('/api/_tylix/features', (req, res) => {
    res.json({
      data: features.map((f) => ({
        name: f.manifest.name,
        table: f.manifest.table,
      })),
    })
  })

  const authEnabled = await registerAuthRoutes(router, baseDir, config.auth)
  const pageRoutes = await registerPageRoutes(router, baseDir)

  const hmr = createHmrChannel(router)
  const watchedDirs = [
    'pages',
    'controllers',
    'models',
    'validators',
    'Features',
  ].map((d) => path.join(baseDir, 'app', d))
  // .tyx files can gain/lose Tailwind class usage on every edit, so
  // rebuild the CSS before notifying the browser to reload -- otherwise
  // the reload can race ahead of the new stylesheet.
  const watchers = watchedDirs.map((dir) =>
    watchDirectoryTree(dir, async () => {
      await buildTailwindCss(baseDir)
      hmr.notify()
    }),
  )

  if (pageRoutes.length === 0 && features.length === 0) {
    router.get('/', (req, res) => {
      res.json({
        message: 'Tylix dev server running',
        features: [],
        auth: authEnabled ? ['/api/register', '/api/login', '/api/me'] : [],
      })
    })
  }

  const server = new Server(router, {
    notFoundHandler: (req, res) => serveStaticAsset(req, res, baseDir),
  })
  server.listen(port, () => {
    printBanner({
      port,
      driver: config.database.driver,
      featureCount: features.length,
      pageCount: pageRoutes.length,
      featureRoutes: features.map((f) => ({ table: f.manifest.table })),
      pageRoutes,
      authEnabled,
    })
  })
}
