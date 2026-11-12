import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FRONTEND_DRIVERS, resolveFrontendConfig } from '@tylix/shared'
import { MIME_TYPES } from '../utils/mime.js'
import { createProjectImporter, resolveFromProject } from './importFromProject.js'
import { injectServerRender, injectSession } from './session.js'

// Hosts a third-party frontend (React today) inside the Tylix server.
//
// The frontend runs on the SAME origin as the API:
//   dev         Vite runs as middleware inside `tylix dev`
//   production  `tylix build` writes dist/client, `tylix start` serves it
// Same origin keeps the httpOnly auth cookies, SameSite=Lax and the
// cross-site write check working with no CORS or proxy setup.
//
// Tylix owns the backend routes (/api/*, feature routes, auth). Every
// other browser navigation gets index.html and the frontend's own router
// decides what to show, including its 404 page.

export const NATIVE_DRIVER = 'tylix'

// driver -> package that provides "<package>/adapter".
export const FRONTEND_PACKAGES = {
  react: '@tylix/react',
  svelte: '@tylix/svelte',
  vue: '@tylix/vue',
  angular: '@tylix/angular',
}

export const BUILD_DIR = path.join('dist', 'client')
export const SERVER_BUILD_DIR = path.join('dist', 'server')

// Where a server-rendered page's markup goes in index.html.
export const SSR_OUTLET = '<!--ssr-outlet-->'

// The module that renders a page on the server, looked up in the frontend
// root. It exports render({ url, session, load }) and resolves
// { html, status?, redirect?, data? }.
const SERVER_ENTRY_NAMES = ['entry-server.tsx', 'entry-server.ts', 'entry-server.jsx', 'entry-server.js']

async function findServerEntry(root) {
  for (const name of SERVER_ENTRY_NAMES) {
    try {
      await fs.access(path.join(root, name))
      return path.join(root, name)
    } catch {
      // try the next name
    }
  }
  return null
}

// SSR is on when tylix.config asks for it (frontend.ssr: true) and the
// adapter supports it. Asking for it where it isn't supported is an error,
// not a silent fallback.
function ssrEnabled(config, adapter) {
  if (config?.frontend?.ssr !== true) return false
  if (!adapter.ssr) {
    throw new Error(
      `frontend.ssr is on, but server-side rendering isn't supported for ${adapter.label ?? adapter.name} yet. Remove ssr from tylix.config.`,
    )
  }
  return true
}

// Turns index.html into the page for one request. With SSR, the server
// entry renders the URL first; its redirect or status is honoured, and its
// markup and loaded data go into the page. A render that throws falls back
// to the client-rendered shell, so a server rendering bug degrades the page
// instead of breaking it.
//
// `fallback` is what the outlet becomes when the page is not server
// rendered: SSR off, or a render that failed. Usually nothing (the outlet
// sits inside the root element), but Angular renders <app-root> itself, so
// its outlet replaces that element and the fallback puts it back.
async function renderDocument(template, { render, url, session, load, onRenderError, fallback = '' }) {
  let html = template.replace(SSR_OUTLET, fallback)
  let status = 200
  if (render) {
    try {
      const out = await render({ url, session, load })
      if (out?.redirect) return { redirect: out.redirect }
      html = template.replace(SSR_OUTLET, out?.html ?? '')
      // Head content the render produced (Svelte's <svelte:head>, Angular's
      // component styles) goes at the end of <head>.
      if (out?.head) html = html.replace('</head>', `${out.head}</head>`)
      html = injectServerRender(html, out?.data ?? {})
      status = out?.status ?? 200
    } catch (err) {
      onRenderError?.(err)
      console.error(`[tylix] Server rendering failed for ${url}; sending the client-rendered page instead.`, err)
    }
  }
  return { html: injectSession(html, session), status }
}

function sendDocument(res, result) {
  if (result.redirect) {
    res.statusCode = 302
    res.setHeader('Location', result.redirect)
    res.setHeader('Cache-Control', 'no-store')
    res.end()
    return
  }
  sendHtml(res, result.html, result.status)
}

function warnMissingOutlet(template, file) {
  if (!template.includes(SSR_OUTLET)) {
    console.warn(`[tylix] SSR is on, but ${file} has no ${SSR_OUTLET} where the page markup goes.`)
  }
}

// The driver list and its validation live in @tylix/shared (loadConfig
// already normalises config.frontend); this also accepts a raw config.
export function resolveFrontendDriver(config) {
  return resolveFrontendConfig(config?.frontend).driver
}

// Every hosted driver @tylix/shared knows must have a package here.
for (const driver of FRONTEND_DRIVERS) {
  if (driver !== NATIVE_DRIVER && !Object.hasOwn(FRONTEND_PACKAGES, driver)) {
    throw new Error(`No @tylix package registered for frontend driver "${driver}".`)
  }
}

export async function loadFrontendAdapter(baseDir, driver) {
  const importFromProject = createProjectImporter(baseDir)
  const pkg = FRONTEND_PACKAGES[driver]
  let mod
  try {
    mod = await importFromProject(`${pkg}/adapter`)
  } catch (err) {
    if (err.code === 'TYLIX_MISSING_PACKAGE') {
      throw new Error(
        `tylix.config sets frontend.driver to "${driver}", but ${pkg} is not installed. ` +
          `Run "npm install ${pkg}".`,
      )
    }
    throw err
  }
  const adapter = mod.default
  return { adapter, importFromProject }
}

// The packages the adapter needs at runtime, checked up front so a
// missing one is named in a single message instead of a stack trace.
async function assertRequiredPackages(baseDir, adapter) {
  const missing = []
  for (const name of adapter.requires ?? []) {
    if (!(await resolveFromProject(baseDir, name).catch(() => null))) missing.push(name)
  }
  if (missing.length > 0) {
    throw new Error(
      `The ${adapter.label ?? adapter.name} frontend needs ${missing.join(', ')}. ` +
        `Run "npm install ${missing.join(' ')}".`,
    )
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// Real folders of the linked @tylix/* packages. Vite only serves files
// inside the project by default, and a package linked from a checkout
// elsewhere (file: dependencies, npm link) lives outside it.
async function linkedPackageDirs(baseDir) {
  const scopeDir = path.join(baseDir, 'node_modules', '@tylix')
  let entries = []
  try {
    entries = await fs.readdir(scopeDir)
  } catch {
    return []
  }
  const dirs = []
  for (const name of entries) {
    try {
      const real = await fs.realpath(path.join(scopeDir, name))
      if (!real.startsWith(path.resolve(baseDir) + path.sep)) dirs.push(real)
    } catch {
      // broken link, ignore
    }
  }
  return dirs
}

async function baseViteConfig(baseDir, { adapter, importFromProject, userVite }) {
  await assertRequiredPackages(baseDir, adapter)
  const vite = await importFromProject('vite')
  const root = path.join(baseDir, adapter.root)
  const plugins = await adapter.vitePlugins({ importFromProject, root, baseDir })
  const config = {
    root,
    configFile: false,
    // Tylix serves public/ itself, before the frontend sees a request.
    publicDir: false,
    clearScreen: false,
    plugins,
    resolve: { dedupe: adapter.dedupe ?? [] },
  }
  // Order: Tylix's base, then what the adapter needs, then the project's
  // own frontend.vite settings, which win.
  const withAdapter = vite.mergeConfig(config, adapter.viteConfig ?? {})
  return { vite, config: vite.mergeConfig(withAdapter, userVite ?? {}) }
}

function sendHtml(res, html, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(html)
}

async function createDevHost(baseDir, options) {
  const { vite, config } = await baseViteConfig(baseDir, options)
  const hmrPort = await freePort()
  const allow = [vite.searchForWorkspaceRoot(baseDir), ...(await linkedPackageDirs(baseDir))]

  const server = await vite.createServer(
    vite.mergeConfig(config, {
      appType: 'custom',
      server: {
        middlewareMode: true,
        // Its own port: the HTTP server is created after the app, and a
        // free port avoids clashes between two apps running at once.
        hmr: { port: hmrPort },
        fs: { allow },
      },
    }),
  )

  const indexFile = path.join(config.root, 'index.html')
  const serverEntry = options.ssr ? await findServerEntry(config.root) : null
  if (options.ssr && !serverEntry) {
    throw new Error(`frontend.ssr is on, but there is no entry-server file in ${path.relative(baseDir, config.root)}.`)
  }

  return {
    mode: 'dev',
    ssr: Boolean(serverEntry),
    // Modules, CSS and Vite's own client. Resolves false when Vite
    // passes the request on.
    handle(req, res) {
      return new Promise((resolve, reject) => {
        const finished = () => resolve(true)
        res.once('finish', finished)
        res.once('close', finished)
        server.middlewares(req, res, (err) => {
          res.off('finish', finished)
          res.off('close', finished)
          if (err) reject(err)
          else resolve(false)
        })
      })
    },
    async serveHtml(req, res, { session = null, load } = {}) {
      try {
        const raw = await fs.readFile(indexFile, 'utf-8')
        const template = await server.transformIndexHtml(req.url, raw)
        let render = null
        if (serverEntry) {
          warnMissingOutlet(template, 'index.html')
          // Loaded per request, so edits to the app show up on reload.
          const entry = await server.ssrLoadModule(serverEntry)
          render = entry.render
        }
        const result = await renderDocument(template, {
          render,
          url: req.url,
          session,
          load,
          fallback: options.adapter.ssrFallback,
          onRenderError: (err) => server.ssrFixStacktrace(err),
        })
        sendDocument(res, result)
      } catch (err) {
        server.ssrFixStacktrace?.(err)
        console.error('[tylix] Could not render index.html:', err)
        sendHtml(
          res,
          `<!doctype html><title>Frontend error</title><pre style="padding:2rem;white-space:pre-wrap">${escapeHtml(err.stack || err.message)}</pre>`,
          500,
        )
      }
    },
    reload() {
      server.ws.send({ type: 'full-reload' })
    },
    close() {
      return server.close()
    },
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

async function createProductionHost(baseDir, { ssr = false, fallback = '' } = {}) {
  const outDir = path.join(baseDir, BUILD_DIR)
  const indexFile = path.join(outDir, 'index.html')
  let html
  try {
    html = await fs.readFile(indexFile, 'utf-8')
  } catch {
    throw new Error(
      `The frontend has not been built (${path.relative(baseDir, indexFile)} is missing). Run "tylix build" first.`,
    )
  }

  let render = null
  if (ssr) {
    const serverFile = path.join(baseDir, SERVER_BUILD_DIR, 'entry-server.js')
    try {
      await fs.access(serverFile)
    } catch {
      throw new Error(
        `SSR is on, but ${path.relative(baseDir, serverFile)} is missing. Run "tylix build" first.`,
      )
    }
    warnMissingOutlet(html, path.relative(baseDir, indexFile))
    ;({ render } = await import(pathToFileURL(serverFile).href))
  }

  return {
    mode: 'production',
    async handle(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false
      let urlPath
      try {
        urlPath = decodeURIComponent(String(req.url).split('?')[0])
      } catch {
        return false
      }
      if (urlPath === '/' || urlPath === '/index.html') return false

      const filePath = path.join(outDir, urlPath)
      if (!filePath.startsWith(outDir + path.sep)) return false

      let stat
      try {
        stat = await fs.stat(filePath)
      } catch {
        return false
      }
      if (!stat.isFile()) return false

      res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] || 'application/octet-stream')
      // Vite fingerprints everything under assets/, so it never changes.
      res.setHeader(
        'Cache-Control',
        urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      )
      res.end(req.method === 'HEAD' ? undefined : await fs.readFile(filePath))
      return true
    },
    async serveHtml(req, res, { session = null, load } = {}) {
      sendDocument(res, await renderDocument(html, { render, url: req.url, session, load, fallback }))
    },
    ssr: Boolean(render),
    reload() {},
    async close() {},
  }
}

export async function createFrontendHost(baseDir, { driver, production, config }) {
  const { adapter, importFromProject } = await loadFrontendAdapter(baseDir, driver)
  const ssr = ssrEnabled(config, adapter)
  const host = production
    ? await createProductionHost(baseDir, { ssr, fallback: adapter.ssrFallback })
    : await createDevHost(baseDir, {
        adapter,
        importFromProject,
        userVite: config?.frontend?.vite,
        ssr,
      })
  return { ...host, driver, label: adapter.label ?? driver }
}

// `tylix build` for a hosted frontend: a production bundle in dist/client.
export async function buildFrontend(baseDir, { driver, config }) {
  const { adapter, importFromProject } = await loadFrontendAdapter(baseDir, driver)
  const { vite, config: viteConfig } = await baseViteConfig(baseDir, {
    adapter,
    importFromProject,
    userVite: config?.frontend?.vite,
  })
  const outDir = path.join(baseDir, BUILD_DIR)
  await vite.build(
    vite.mergeConfig(viteConfig, {
      mode: 'production',
      build: { outDir, emptyOutDir: true },
    }),
  )

  // SSR: a second, Node-targeted build of the server entry, which
  // `tylix start` imports to render pages.
  let serverOutDir = null
  if (ssrEnabled(config, adapter)) {
    const serverEntry = await findServerEntry(viteConfig.root)
    if (!serverEntry) {
      throw new Error(`frontend.ssr is on, but there is no entry-server file in ${path.relative(baseDir, viteConfig.root)}.`)
    }
    serverOutDir = path.join(baseDir, SERVER_BUILD_DIR)
    await vite.build(
      vite.mergeConfig(viteConfig, {
        mode: 'production',
        build: { ssr: serverEntry, outDir: serverOutDir, emptyOutDir: true },
      }),
    )
  }
  return { outDir, serverOutDir, label: adapter.label ?? driver }
}
