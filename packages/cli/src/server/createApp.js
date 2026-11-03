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
import { renderStatusPage, wantsHtml } from '../utils/status-page.js'

const DEV_AUTH_SECRET = 'tylix-dev-secret-change-me'

// Stylesheets a project may have in public/, in link order. tailwind.css
// comes from the Tailwind build; styles.css is the project's own file
// (or the precompiled starter styles for non-Tailwind projects). Listing
// styles.css last lets a project override Tailwind output.
const STYLESHEET_CANDIDATES = ['tailwind.css', 'styles.css']

// Special page file. The closest one to the requested URL renders with a
// 404 status. It is never a route itself.
const NOT_FOUND_FILE = '_not-found.tyx'

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
  '.webp': 'image/webp',
  '.gif': 'image/gif',
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
  router.get('/api/auth/verify-email', (req, res) => {
    // Browsers (the link in the email) get a themed page; API clients keep JSON.
    if (wantsHtml(req)) {
      res.json = (body) => {
        const ok = body?.ok === true
        res.setHeader('Content-Type', 'text/html')
        res.end(
          renderStatusPage({
            tone: ok ? 'success' : 'error',
            title: ok ? 'Email verified' : 'Verification failed',
            message: ok
              ? (body?.message ?? 'Your email is verified. You can now log in.')
              : (body?.error ??
                body?.message ??
                'This link is invalid or has expired.'),
            actions: ok
              ? [
                  { label: 'Log in', href: '/login' },
                  { label: 'Go home', href: '/' },
                ]
              : [{ label: 'Go home', href: '/' }],
          }),
        )
      }
    }
    return controller.verifyEmail(req, res)
  })
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
    } else if (
      entry.name.endsWith('.tyx') &&
      entry.name !== '_layout.tyx' &&
      entry.name !== NOT_FOUND_FILE
    ) {
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
//
// Returns { source, imports, file }. `file` is the layout's own path:
// relative imports inside a layout resolve against ITS folder, not the
// page's.
async function findLayoutForFile(pagesDir, filePath, extractImports) {
  let dir = path.dirname(filePath)
  while (true) {
    const layoutPath = path.join(dir, '_layout.tyx')
    if (await pathExists(layoutPath)) {
      const raw = await fs.readFile(layoutPath, 'utf-8')
      const { imports, source } = extractImports(raw)
      return { source, imports, file: layoutPath }
    }
    if (dir === pagesDir) return null
    dir = path.dirname(dir)
  }
}

// Adds "In <label>: " to an error message once, so a failure inside a
// component or layout says which file it came from.
function labelError(err, label) {
  if (err && typeof err.message === 'string' && !err.message.startsWith('In ')) {
    err.message = `In ${label}: ${err.message}`
  }
  return err
}

// Merges component sources into `target`. The registry is flat per
// page, so one name can only mean one component: the same name backed
// by different source text is a hard error, not a silent overwrite.
function mergeComponents(target, owners, incoming, from) {
  for (const [name, text] of Object.entries(incoming)) {
    if (Object.hasOwn(target, name) && target[name] !== text) {
      throw new Error(
        `Component "${name}" is imported differently by ${owners[name]} and ${from}; give one of them another name ("import X as Y" for packages, a different local name for files)`,
      )
    }
    target[name] = text
    owners[name] = from
  }
}

const warnedOnce = new Set()
function warnOnce(message) {
  if (warnedOnce.has(message)) return
  warnedOnce.add(message)
  console.warn(message)
}

// "admin-panel" / "admin_panel" -> "AdminPanel"
function pascalSegment(segment) {
  return segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')
}

// Everything under app/pages/components/, at any depth.
//
// Tag names: a file's name is its tag (Card.tyx -> <Card>). When two
// files share a name in different folders:
//   - the shallowest one keeps the bare name, if it is unambiguous;
//   - at equal depth NEITHER gets the bare name (a silent winner is how
//     the wrong card ends up on a page) and a warning says so;
//   - every file in the clashing group is also registered under a
//     folder-qualified name: a/Card.tyx -> <ACard>, admin/forms/Input.tyx
//     -> <AdminFormsInput>.
// Names that are not clashing get no alias, because every registered
// component is compiled into every page.
//
// Each component file's own imports (packages, relative files) are
// resolved against that file's folder. Returns
//   { components, imported }
// where `imported` holds what those imports pulled in.
async function loadComponents(
  pagesDir,
  { baseDir, extractImports, resolveImportedComponents },
) {
  const componentsDir = path.join(pagesDir, 'components')
  if (!(await pathExists(componentsDir))) {
    return { components: {}, imported: {} }
  }

  const files = []
  async function walk(dir, segments) {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, [...segments, entry.name])
      } else if (entry.name.endsWith('.tyx')) {
        files.push({
          fullPath,
          segments,
          base: entry.name.replace(/\.tyx$/, ''),
          rel: path.relative(baseDir, fullPath),
          source: '',
        })
      }
    }
  }
  await walk(componentsDir, [])

  const imported = {}
  const importedFrom = {}

  for (const f of files) {
    const raw = await fs.readFile(f.fullPath, 'utf-8')
    try {
      // Import lines are blanked out (keeping line numbers) before the
      // text ever reaches the Lexer/Parser.
      const { imports, source } = extractImports(raw)
      f.source = source
      if (imports.length > 0) {
        const resolved = await resolveImportedComponents(imports, {
          baseDir,
          fromFile: f.fullPath,
        })
        mergeComponents(imported, importedFrom, resolved, f.rel)
      }
    } catch (err) {
      throw labelError(err, f.rel)
    }
  }

  const byBase = new Map()
  for (const f of files) {
    if (!byBase.has(f.base)) byBase.set(f.base, [])
    byBase.get(f.base).push(f)
  }

  const components = {}
  for (const [base, group] of byBase) {
    group.sort(
      (a, b) =>
        a.segments.length - b.segments.length ||
        a.fullPath.localeCompare(b.fullPath),
    )
    const best = group[0]
    const tied =
      group.length > 1 && group[1].segments.length === best.segments.length

    if (!tied) components[base] = best.source

    if (group.length > 1) {
      const aliases = group.map(
        (f) => f.segments.map(pascalSegment).join('') + f.base,
      )
      warnOnce(
        tied
          ? `[tylix] Several components are named "${base}" (${group.map((f) => f.rel).join(', ')}). ` +
              `"<${base}>" is not registered because it is ambiguous; use ${aliases.map((a) => `<${a}>`).join(' / ')} or import one explicitly.`
          : `[tylix] "<${base}>" resolves to ${best.rel}; the other "${base}" components are available as ${aliases
              .slice(1)
              .map((a) => `<${a}>`)
              .join(', ')}.`,
      )
      group.forEach((f, i) => {
        const qualified = aliases[i]
        if (f.segments.length > 0 && !Object.hasOwn(components, qualified)) {
          components[qualified] = f.source
        }
      })
    }
  }

  return { components, imported }
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

async function collectNotFoundFiles(dir, segments = [], found = []) {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => [])
  for (const entry of entries) {
    if (entry.isFile() && entry.name === NOT_FOUND_FILE) {
      found.push({ segments, file: path.join(dir, entry.name) })
    } else if (entry.isDirectory() && entry.name !== 'components') {
      const dynamic = /^\[(.+)\]$/.exec(entry.name)
      const segment = dynamic ? `:${dynamic[1]}` : entry.name.toLowerCase()
      await collectNotFoundFiles(
        path.join(dir, entry.name),
        [...segments, segment],
        found,
      )
    }
  }
  return found
}

// The deepest not-found file whose folder prefix matches the URL.
function pickNotFound(found, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const parts = decoded
    .split('/')
    .filter(Boolean)
    .map((s) => s.toLowerCase())

  let best = null
  for (const item of found) {
    const { segments } = item
    if (segments.length > parts.length) continue
    const matches = segments.every(
      (seg, i) => seg.startsWith(':') || seg === parts[i],
    )
    if (matches && (!best || segments.length > best.segments.length)) {
      best = item
    }
  }
  return best ? best.file : null
}

async function registerPageRoutes(
  router,
  baseDir,
  { hotReloadCompiler, production, compilerOptions, loadingBar = true },
) {
  const pagesDir = path.join(baseDir, 'app', 'pages')
  if (!(await pathExists(pagesDir))) {
    return { routes: [], renderNotFound: null }
  }

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
      resolveImportedComponents,
    } = hotReloadCompiler
      ? await import(`${compilerEntryUrl}?t=${Date.now()}`)
      : staticCompiler

    const pageLabel = path.relative(baseDir, filePath)

    const rawSource = await fs.readFile(filePath, 'utf-8')
    ctx.source = rawSource // so an import error still gets a code frame

    let pageImports
    let source
    try {
      ;({ imports: pageImports, source } = extractImports(rawSource))
    } catch (err) {
      throw labelError(err, pageLabel)
    }
    ctx.source = source

    // Production skips this: `tylix build` already typechecked every
    // page, and running the TypeScript checker is expensive.
    if (!production) {
      const projectLanguage = await detectLanguage(baseDir)
      if (projectLanguage === 'typescript') {
        const apiHelpersSource = await loadApiHelpersForTypecheck(baseDir)
        const diagnostics = typecheckPage(
          source,
          apiHelpersSource,
          compilerOptions,
        )
        if (diagnostics.length > 0) {
          const message = diagnostics
            .map((d) => `Line ${d.line}: ${d.message}`)
            .join('\n')
          throw new Error(`TypeScript errors in ${filePath}:\n${message}`)
        }
      }
    }

    let layoutResult
    try {
      layoutResult = await findLayoutForFile(pagesDir, filePath, extractImports)
    } catch (err) {
      throw labelError(err, `the layout for ${pageLabel}`)
    }
    const layout = layoutResult ? layoutResult.source : null

    // Imports are resolved PER FILE: a relative path like "./a/Card"
    // only means something relative to the file that wrote it.
    const explicit = {}
    const explicitFrom = {}
    try {
      mergeComponents(
        explicit,
        explicitFrom,
        await resolveImportedComponents(pageImports, {
          baseDir,
          fromFile: filePath,
        }),
        pageLabel,
      )
    } catch (err) {
      throw labelError(err, pageLabel)
    }
    if (layoutResult) {
      const layoutLabel = path.relative(baseDir, layoutResult.file)
      try {
        mergeComponents(
          explicit,
          explicitFrom,
          await resolveImportedComponents(layoutResult.imports, {
            baseDir,
            fromFile: layoutResult.file,
          }),
          layoutLabel,
        )
      } catch (err) {
        throw labelError(err, layoutLabel)
      }
    }

    const { components: localComponents, imported: componentImported } =
      await loadComponents(pagesDir, {
        baseDir,
        extractImports,
        resolveImportedComponents,
      })

    // Precedence, lowest to highest:
    //   1. things components import (packages / relative files)
    //   2. components discovered under app/pages/components/
    //      (a project can always override a package component by adding
    //      its own file)
    //   3. what the page or its layout imports explicitly
    const components = {
      ...componentImported,
      ...localComponents,
      ...explicit,
    }

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
          language: compilerOptions,
          loadingBar,
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

  // Renders the closest _not-found.tyx for an unmatched URL, with status 404.
  // Dev re-scans on every miss, so adding the file needs no restart.
  // Production scans once.
  let notFoundCache = null
  async function renderNotFound(req, res) {
    let found
    if (production && notFoundCache) {
      found = notFoundCache
    } else {
      found = await collectNotFoundFiles(pagesDir)
      if (production) notFoundCache = found
    }

    const file = pickNotFound(found, String(req.url).split('?')[0])
    if (!file) return false

    const { html, ok } = await renderFileSafely(file, {})
    res.status(ok ? 404 : 500)
    res.setHeader('Content-Type', 'text/html')
    res.end(html)
    return true
  }

  return { routes: registered, renderNotFound }
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

  // Compiler switches from the project config, e.g. { not: 'loose' }.
  // Omitted means legacy behaviour. Not to be confused with `language`
  // above, which is 'typescript' | 'javascript'.
  const compilerOptions = config.compiler ?? {}

  await bootstrapDatabase()

  const features = await discoverFeatures(baseDir)
  const router = new Router()

  await loadCustomRoutes(router, baseDir, {
    secret: config.auth?.secret,
    hydrate: config.auth?.hydrate,
  })
  
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

  const { routes: pageRoutes, renderNotFound } = await registerPageRoutes(
    router,
    baseDir,
    {
      hotReloadCompiler,
      production,
      compilerOptions,
      loadingBar: config.loadingBar !== false,
    },
  )

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
    notFoundHandler: async (req, res) => {
      if (await serveStaticAsset(req, res, baseDir, { production })) return true

      // Browser navigations only. /api/* and fetch calls keep the JSON 404.
      if (wantsHtml(req) && !String(req.url).startsWith('/api/')) {
        if (renderNotFound && (await renderNotFound(req, res))) return true

        res.status(404)
        res.setHeader('Content-Type', 'text/html')
        res.end(
          renderStatusPage({
            tone: 'notfound',
            code: '404',
            title: 'Page not found',
            message:
              "The page you're looking for doesn't exist or has been moved.",
            actions: [{ label: 'Go home', href: '/' }],
          }),
        )
        return true
      }
      return false
    },
  }
}