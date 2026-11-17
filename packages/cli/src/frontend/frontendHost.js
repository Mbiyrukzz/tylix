import { loadingScreenHtml } from '@tylix/compiler'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildDebugPayload, renderDebugPage } from '@tylix/core'
import { FRONTEND_DRIVERS, resolveFrontendConfig, resolveViewsDir } from '@tylix/shared'
import { MIME_TYPES } from '../utils/mime.js'
import { createProjectImporter, resolveFromProject } from './importFromProject.js'
import { injectChannelsPort, injectServerRender, injectSession } from './session.js'

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
async function renderDocument(template, { render, url, session, load, onRenderError, fallback = '', channelsPort, extraHead = '', loadingScreen = true }) {
  let html = template.replace(SSR_OUTLET, fallback)
  let rendered = false
  let status = 200
  let renderError = null
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
      rendered = true
    } catch (err) {
      onRenderError?.(err)
      console.error(`[tylix] Server rendering failed for ${url}; sending the client-rendered page instead.`, err)
      renderError = err
    }
  }
  // PWA tags and such, from the server.
  if (extraHead) html = html.includes('</head>') ? html.replace('</head>', `${extraHead}\n</head>`) : extraHead + html
  // A page the browser renders from scratch shows the loading screen
  // until its root element fills; a server-rendered one has content already.
  if (!rendered && loadingScreen) {
    const screen = loadingScreenHtml({ root: '#root, #app, app-root' })
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (open) => `${open}\n  ${screen}`) : screen + html
  }
  return { html: injectChannelsPort(injectSession(html, session), channelsPort), status, renderError }
}

// Dev only: when server rendering failed, the page still works (the
// browser renders it), but the failure would otherwise only be in the
// terminal. This opens Vite's error overlay with it, over the page.
export function injectSsrErrorOverlay(html, err) {
  const payload = {
    message: `Server rendering failed, so this page was rendered in the browser instead.\n\n${err?.message ?? err}`,
    stack: String(err?.stack ?? ''),
    id: err?.id,
    frame: err?.frame,
    loc: err?.loc,
    plugin: err?.plugin,
  }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')
  const script =
    `<script type="module">import { ErrorOverlay } from '/@vite/client';` +
    `document.body.appendChild(new ErrorOverlay(${json}))</script>`
  return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : html + script
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

export function freePort() {
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
  // adapter.root is app/views; a project made before 2.0 keeps app/frontend.
  const root = adapter.root === 'app/views' ? resolveViewsDir(baseDir) : path.join(baseDir, adapter.root)
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
  // Under `tylix dev` the supervisor picks one HMR port for the whole
  // session. A restarted server binds that same port again, so open tabs
  // reconnect and reload; a new port each time would leave them pinging
  // the old one forever.
  const hmrPort = Number(process.env.TYLIX_DEV_HMR_PORT) || (await freePort())
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
  if (serverEntry) keepSsrModulesFresh(server)

  return {
    mode: 'dev',
    vite: server,
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
          channelsPort: options.channelsPort,
          extraHead: options.extraHead,
          loadingScreen: options.loadingScreen,
          onRenderError: (err) => server.ssrFixStacktrace(err),
        })
        if (result.renderError) result.html = injectSsrErrorOverlay(result.html, result.renderError)
        sendDocument(res, result)
      } catch (err) {
        // index.html itself could not be prepared (a broken entry-server
        // import, a Vite plugin error): there is no page to fall back to,
        // so the request gets the full debug page.
        server.ssrFixStacktrace?.(err)
        console.error('[tylix] Could not render index.html:', err)
        sendHtml(res, renderFrontendDebugPage(err, req), 500)
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

// Server rendering loads the app through Vite's SSR module graph, which
// only refreshes what the framework plugin tells it to. Angular's
// component HMR patches the browser in place and its runtime keeps the old
// component definitions, so even re-evaluating the changed module renders
// the old template. Dropping the whole SSR graph on any saved file makes
// the next render start from fresh modules. Only the SSR graph: the
// browser keeps its HMR, and dependencies left external are Node modules,
// which this never reloads.
export function keepSsrModulesFresh(server) {
  const graph = server.environments?.ssr?.moduleGraph ?? server.moduleGraph
  const invalidate = () => graph?.invalidateAll()
  for (const event of ['change', 'add', 'unlink']) server.watcher?.on(event, invalidate)
}

function renderFrontendDebugPage(err, req) {
  try {
    return renderDebugPage(buildDebugPayload(err, req, { status: 500 }))
  } catch (pageErr) {
    // The debug page must never be why a request hangs or shows nothing.
    console.error('[tylix] debug page failed:', pageErr)
    return `<!doctype html><title>Frontend error</title><pre style="padding:2rem;white-space:pre-wrap">${escapeHtml(err?.stack || err?.message || err)}</pre>`
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

async function createProductionHost(baseDir, { ssr = false, fallback = '', channelsPort, extraHead = '', loadingScreen = true } = {}) {
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
      sendDocument(res, await renderDocument(html, { render, url: req.url, session, load, fallback, channelsPort, extraHead, loadingScreen }))
    },
    ssr: Boolean(render),
    reload() {},
    async close() {},
  }
}

export async function createFrontendHost(baseDir, { driver, production, config, extraHead = '' }) {
  const { adapter, importFromProject } = await loadFrontendAdapter(baseDir, driver)
  const ssr = ssrEnabled(config, adapter)
  const channelsPort = config?.channels?.port
  const loadingScreen = config?.loadingScreen !== false
  const host = production
    ? await createProductionHost(baseDir, { ssr, fallback: adapter.ssrFallback, channelsPort, extraHead, loadingScreen })
    : await createDevHost(baseDir, {
        channelsPort,
        extraHead,
        loadingScreen,
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
