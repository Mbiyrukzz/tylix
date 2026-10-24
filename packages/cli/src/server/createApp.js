import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  Router,
  discoverFeatures,
  registerFeatureRoutes,
  registerRouteFiles,
  requireAuth,
  loadCustomRoutes,
} from '@tylix/core'
import { MailLog } from '@tylix/mail'
import { loadConfig, loadEnv, detectLanguage } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'
import { HMR_CLIENT_SCRIPT } from '../hotReload.js'
import { renderErrorPage } from '../utils/error-page.js'

const DEV_AUTH_SECRET = 'tylix-dev-secret-change-me'

// Stylesheets a project may have in public/, in link order. tailwind.css
// comes from the Tailwind build; styles.css is the project's own file
// (or the precompiled starter styles for non-Tailwind projects). Listing
// styles.css last lets a project override Tailwind output.
const STYLESHEET_CANDIDATES = ['tailwind.css', 'styles.css']

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

async function resolveStylesheets(baseDir) {
  const found = []
  for (const file of STYLESHEET_CANDIDATES) {
    if (await pathExists(path.join(baseDir, 'public', file))) {
      found.push(`/${file}`)
    }
  }
  return found
}

async function resolveCompilerEntryUrl(baseDir) {
  const pkgDir = path.join(baseDir, 'node_modules', '@tylix', 'compiler')
  const realPkgDir = await fs.realpath(pkgDir)
  return pathToFileURL(path.join(realPkgDir, 'src', 'index.js')).href
}

async function loadApiHelpers(baseDir, transpileTsToJs) {
  const apiDir = path.join(baseDir, 'app', 'useApi')
  if (!(await pathExists(apiDir))) return ''

  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? '.ts' : '.js'

  const entries = await fs.readdir(apiDir, { withFileTypes: true })
  const sources = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(ext)) {
      const raw = await fs.readFile(path.join(apiDir, entry.name), 'utf-8')
      const stripped = raw
        .replace(/^import\s+.*$/gm, '')
        .replace(/export\s+/g, '')
      sources.push(
        language === 'typescript' ? transpileTsToJs(stripped) : stripped,
      )
    }
  }
  return sources.join('\n\n')
}

async function loadApiHelpersForTypecheck(baseDir) {
  const apiDir = path.join(baseDir, 'app', 'useApi')
  if (!(await pathExists(apiDir))) return ''

  const entries = await fs.readdir(apiDir, { withFileTypes: true })
  const sources = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      const raw = await fs.readFile(path.join(apiDir, entry.name), 'utf-8')
      sources.push(
        raw.replace(/^import\s+.*$/gm, '').replace(/export\s+/g, ''),
      )
    }
  }
  return sources.join('\n\n')
}

const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Serves static assets from public/ (Tailwind's compiled CSS, logo
// images, favicons). This is a fallback in the Server's 404 handler
// path rather than a router registration, since static filenames
// aren't known ahead of time the way feature/page routes are.
async function serveStaticAsset(req, res, baseDir, { production }) {
  const publicDir = path.join(baseDir, 'public')
  const urlPath = req.url.split('?')[0]

  let filePath
  try {
    filePath = path.join(publicDir, decodeURIComponent(urlPath))
  } catch {
    return false // malformed percent-encoding
  }

  // Path traversal guard. The trailing separator matters: a bare
  // startsWith(publicDir) would also accept a sibling like "public-evil".
  if (!filePath.startsWith(publicDir + path.sep)) return false

  if (!(await pathExists(filePath))) return false

  const stat = await fs.stat(filePath)
  if (!stat.isFile()) return false

  const ext = path.extname(filePath)
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
  if (production) res.setHeader('Cache-Control', 'public, max-age=3600')
  res.end(await fs.readFile(filePath))
  return true
}

// Auth isn't a "Feature" discovered via feature.json the way Post is --
// its routes are registered explicitly here. `refresh` and `logout`
// are deliberately NOT wrapped in requireAuth: they're what the client
// calls precisely when the access token is missing/expired, so gating
// them behind a valid access token would make them unreachable exactly
// when they're needed. Only `me` needs an active session.
async function registerAuthRoutes(router, baseDir, authConfig, mailConfig) {
  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'

  const controllerPath = path.join(
    baseDir,
    'app',
    'controllers',
    `AuthController.${ext}`,
  )
  if (!(await pathExists(controllerPath))) return false

  const { AuthController } = await import(pathToFileURL(controllerPath).href)

  const controller = new AuthController({
    secret: authConfig.secret,
    tokenExpiresInSeconds: authConfig.tokenExpiresInSeconds,
    mailConfig,
  })

  router.post('/api/register', (req, res) => controller.register(req, res))
  router.post('/api/login', (req, res) => controller.login(req, res))
  router.post('/api/auth/refresh', (req, res) => controller.refresh(req, res))
  router.post('/api/auth/logout', (req, res) => controller.logout(req, res))
  router.get('/api/auth/verify-email', (req, res) =>
    controller.verifyEmail(req, res),
  )
  router.post('/api/auth/forgot-password', (req, res) =>
    controller.forgotPassword(req, res),
  )
  router.post('/api/auth/reset-password', (req, res) =>
    controller.resetPassword(req, res),
  )
  router.get(
    '/api/me',
    requireAuth((req, res) => controller.me(req, res), authConfig.secret),
  )

  return true
}

function injectHmrScript(html) {
  return html.replace('</body>', `${HMR_CLIENT_SCRIPT}</body>`)
}

async function walkPagesDir(dir) {
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
async function findLayoutForFile(pagesDir, filePath, extractImports) {
  let dir = path.dirname(filePath)
  while (true) {
    const layoutPath = path.join(dir, '_layout.tyx')
    if (await pathExists(layoutPath)) {
      const raw = await fs.readFile(layoutPath, 'utf-8')
      return extractImports(raw)
    }
    if (dir === pagesDir) return null
    dir = path.dirname(dir)
  }
}

async function loadComponents(pagesDir, extractImports) {
  const componentsDir = path.join(pagesDir, 'components')
  if (!(await pathExists(componentsDir))) return { components: {}, imports: [] }

  const components = {}
  const imports = []

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.name.endsWith('.tyx')) {
        const name = entry.name.replace(/\.tyx$/, '')
        const raw = await fs.readFile(fullPath, 'utf-8')
        // Components can import package components (icons, etc.) the
        // same way a page can -- strip those import lines here,
        // before the raw text ever reaches compileComponentSource's
        // Parser, and collect them so their targets get resolved
        // into the shared components map alongside this component.
        const { imports: componentImports, source: cleaned } =
          extractImports(raw)
        components[name] = cleaned
        imports.push(...componentImports)
      }
    }
  }

  await walk(componentsDir)
  return { components, imports }
}

function renderProductionErrorPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Something went wrong</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#334155">
<div style="text-align:center">
<h1 style="font-size:1.25rem;margin:0 0 .5rem">Something went wrong</h1>
<p style="margin:0;color:#64748b">Please try again in a moment.</p>
</div>
</body>
</html>`
}

async function registerPageRoutes(
  router,
  baseDir,
  { hotReloadCompiler, production },
) {
  const pagesDir = path.join(baseDir, 'app', 'pages')
  if (!(await pathExists(pagesDir))) return []

  const files = await walkPagesDir(pagesDir)

  const staticCompiler = hotReloadCompiler
    ? null
    : await import('@tylix/compiler')

  const compilerEntryUrl = hotReloadCompiler
    ? await resolveCompilerEntryUrl(baseDir)
    : null

  // Everything that doesn't depend on the request: the cleaned page
  // source, layout, components, API helpers, stylesheets. `ctx.source`
  // is set as soon as it's known so a failure later still gets a code
  // frame in the dev error page.
  async function preparePage(filePath, ctx) {
    const {
      renderPageDocument,
      typecheckPage,
      transpileTsToJs,
      extractImports,
      resolvePackageComponents,
    } = hotReloadCompiler
      ? await import(`${compilerEntryUrl}?t=${Date.now()}`)
      : staticCompiler

    const rawSource = await fs.readFile(filePath, 'utf-8')
    const { imports: pageImports, source } = extractImports(rawSource)
    ctx.source = source

    // Production skips this: `tylix build` already typechecked every
    // page, and running the TypeScript checker is expensive.
    if (!production) {
      const language = await detectLanguage(baseDir)
      if (language === 'typescript') {
        const apiHelpersSource = await loadApiHelpersForTypecheck(baseDir)
        const diagnostics = typecheckPage(source, apiHelpersSource)
        if (diagnostics.length > 0) {
          const message = diagnostics
            .map((d) => `Line ${d.line}: ${d.message}`)
            .join('\n')
          throw new Error(`TypeScript errors in ${filePath}:\n${message}`)
        }
      }
    }

    const layoutResult = await findLayoutForFile(
      pagesDir,
      filePath,
      extractImports,
    )
    const layout = layoutResult ? layoutResult.source : null
    const layoutImports = layoutResult ? layoutResult.imports : []

    const { components: localComponents, imports: componentImports } =
      await loadComponents(pagesDir, extractImports)

    const allImports = [...pageImports, ...layoutImports, ...componentImports]
    const packageComponents =
      allImports.length > 0
        ? await resolvePackageComponents(allImports, baseDir)
        : {}

    // Local components win on a name collision -- a project can
    // always override a package-provided component just by adding
    // its own file under app/pages/components/.
    const components = { ...packageComponents, ...localComponents }

    const apiHelpers = await loadApiHelpers(baseDir, transpileTsToJs)
    const channelsPort = Number(process.env.CHANNELS_PORT) || 6001

    // Dev re-checks public/ on every request, so a Tailwind build that
    // finishes after startup is picked up on the next reload.
    const stylesheets = await resolveStylesheets(baseDir)

    return {
      renderPageDocument,
      source,
      layout,
      components,
      apiHelpers,
      channelsPort,
      stylesheets,
    }
  }

  // Dev prepares on every request (so edits show up immediately).
  // Production prepares once per page and reuses the result; a failed
  // preparation is not cached, so a transient error can recover.
  const preparedCache = new Map()
  function getPrepared(filePath, ctx) {
    if (!production) return preparePage(filePath, ctx)
    let promise = preparedCache.get(filePath)
    if (!promise) {
      promise = preparePage(filePath, ctx).catch((err) => {
        preparedCache.delete(filePath)
        throw err
      })
      preparedCache.set(filePath, promise)
    }
    return promise
  }

  async function renderFileSafely(filePath, params = {}) {
    const ctx = { source: null }
    try {
      const prepared = await getPrepared(filePath, ctx)
      const html = await prepared.renderPageDocument(
        prepared.source,
        prepared.components,
        {
          layout: prepared.layout,
          props: params,
          apiHelpers: prepared.apiHelpers,
          channelsPort: prepared.channelsPort,
          stylesheets: prepared.stylesheets,
        },
      )
      return { html: production ? html : injectHmrScript(html), ok: true }
    } catch (err) {
      if (production) {
        console.error(
          `[tylix] Error rendering ${path.relative(baseDir, filePath)}:`,
          err,
        )
        return { html: renderProductionErrorPage(), ok: false }
      }
      return {
        html: renderErrorPage(err, { file: filePath, source: ctx.source }),
        ok: false,
      }
    }
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
      const { html, ok } = await renderFileSafely(filePath, req.params)
      if (!ok) res.status(500)
      res.end(html)
    })
    registered.push(routePath)
  }

  const homeFile = path.join(pagesDir, 'Home.tyx')
  if (files.includes(homeFile)) {
    router.get('/', async (req, res) => {
      res.setHeader('Content-Type', 'text/html')
      const { html, ok } = await renderFileSafely(homeFile, req.params)
      if (!ok) res.status(500)
      res.end(html)
    })
  }

  return registered
}

// Refuses to run production with a missing or default auth secret --
// the default is public (it's in the framework source), so anyone
// could forge tokens.
function assertProductionConfig(config) {
  const secret = config?.auth?.secret
  if (!secret || secret === DEV_AUTH_SECRET) {
    throw new Error(
      'auth.secret is missing or still the public default dev secret. ' +
        'Set AUTH_SECRET in the environment before running `tylix start`.',
    )
  }
}

// Builds the router and everything behind it, shared by `tylix dev`
// and `tylix start`. Returns the pieces the caller needs to create the
// Server; the caller owns HMR, file watching, banners and listening.
export async function createApp(
  baseDir,
  { production = false, hotReloadCompiler = false } = {},
) {
  await loadEnv(baseDir)
  const language = await detectLanguage(baseDir)
  const config = await loadConfig(baseDir, language)
  if (production) assertProductionConfig(config)

  await bootstrapDatabase()

  const features = await discoverFeatures(baseDir)
  const router = new Router()

  await loadCustomRoutes(router, baseDir)
  await registerRouteFiles(router, baseDir, {
    secret: config.auth?.secret,
    hydrate: config.auth?.hydrate,
  })

  registerFeatureRoutes(router, features, {
    secret: config.auth?.secret,
    hydrate: config.auth?.hydrate,
  })

  router.get('/api/_tylix/features', (req, res) => {
    res.json({
      data: features
        .filter((f) => f.manifest.table !== 'posts')
        .map((f) => ({
          name: f.manifest.name,
          table: f.manifest.table,
        })),
    })
  })

  // Mail logs hold password-reset, verification and invite links, and
  // MailLog.recent() returns every user's mail, not just the caller's.
  // So these dev tools are never registered in production, where they
  // answer 404. A logged-in check alone isn't enough: any signed-in
  // user could read everyone else's links.
  if (!production) {
    router.get('/api/_tylix/mail-logs', async (req, res) => {
      const logs = await MailLog.recent(50)
      res.json({ data: logs })
    })

    router.post('/api/_tylix/test-mail', async (req, res) => {
      const { Mail } = await import('@tylix/mail')
      const result = await Mail.send(
        {
          to: 'test@example.com',
          subject: 'Test Email',
          view: 'test',
          data: { name: 'World' },
        },
        config.mail,
      )
      res.json({ result })
    })
  }

  const authEnabled = await registerAuthRoutes(
    router,
    baseDir,
    config.auth,
    config.mail,
  )
  const pageRoutes = await registerPageRoutes(router, baseDir, {
    hotReloadCompiler,
    production,
  })

  if (pageRoutes.length === 0 && features.length === 0) {
    router.get('/', (req, res) => {
      res.json({
        message: production
          ? 'Tylix server running'
          : 'Tylix dev server running',
        features: [],
        auth: authEnabled
          ? [
              '/api/register',
              '/api/login',
              '/api/auth/refresh',
              '/api/auth/logout',
              '/api/auth/verify-email',
              '/api/auth/forgot-password',
              '/api/auth/reset-password',
              '/api/me',
            ]
          : [],
      })
    })
  }

  return {
    router,
    config,
    features,
    pageRoutes,
    authEnabled,
    notFoundHandler: (req, res) =>
      serveStaticAsset(req, res, baseDir, { production }),
  }
}