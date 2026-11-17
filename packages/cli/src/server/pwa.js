import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { devServiceWorker, headTags, manifest, offlinePage, resolveOptions, serviceWorker } from '@tylix/pwa'

// Installable app and offline support, from `pwa` in tylix.config:
//
//   pwa: { name: 'Acme', themeColor: '#0034CA' }     or simply   pwa: true
//
// Serves /manifest.webmanifest and /sw.js, and gives every page (native or
// React, Vue, Svelte, Angular) the head tags that register the worker.
// Development serves a worker that removes itself, unless pwa.dev is true.

const PRECACHE_EXT = new Set(['.css', '.js', '.mjs', '.svg', '.png', '.ico', '.webp', '.woff2', '.woff', '.json', '.html'])
const MAX_PRECACHE = 150
const MAX_FILE = 1024 * 1024

async function listFiles(dir, { recursive = false } = {}) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive })
  } catch {
    return []
  }
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? e.path ?? dir, e.name))
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

// Static files worth having offline: what sits at the top of public/
// (stylesheets, icons, the offline page) and, for a built React, Vue,
// Svelte or Angular app, its fingerprinted bundle. Never pages, never
// uploads.
async function precacheList(baseDir, { production }) {
  if (!production) return []
  const roots = [
    { dir: path.join(baseDir, 'public'), recursive: false },
    { dir: path.join(baseDir, 'dist', 'client', 'assets'), recursive: true, prefix: '/assets' },
  ]
  const out = []
  for (const { dir, recursive, prefix } of roots) {
    for (const file of await listFiles(dir, { recursive })) {
      const ext = path.extname(file).toLowerCase()
      if (!PRECACHE_EXT.has(ext) || file.endsWith('.map')) continue
      const stat = await fs.stat(file)
      if (stat.size > MAX_FILE) continue
      const rel = path.relative(dir, file).split(path.sep).join('/')
      out.push({ url: `${prefix ?? ''}/${rel}`, size: stat.size, mtime: stat.mtimeMs })
      if (out.length >= MAX_PRECACHE) return out
    }
  }
  return out
}

export async function createPwa(baseDir, config, { production }) {
  if (!config?.pwa) return null
  const userOptions = config.pwa === true ? {} : config.pwa
  const publicDir = path.join(baseDir, 'public')

  // Icons the app ships, unless the config lists its own.
  let icons = userOptions.icons
  if (!icons) {
    const candidates = [
      { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
    icons = []
    for (const icon of candidates) if (await exists(path.join(publicDir, icon.src))) icons.push(icon)
    if (icons.length === 0) {
      console.warn('[pwa] No icons in public/ (pwa-192.png, pwa-512.png). Run "tylix make:pwa" to add them; browsers will not offer to install without them.')
    }
  }
  const appleTouchIcon =
    userOptions.appleTouchIcon ?? ((await exists(path.join(publicDir, 'apple-touch-icon.png'))) ? '/apple-touch-icon.png' : null)
  const offline = userOptions.offline !== undefined ? userOptions.offline : (await exists(path.join(publicDir, 'offline.html'))) ? '/offline.html' : null

  const files = await precacheList(baseDir, { production })
  const precache = [...files.map((f) => f.url), ...(userOptions.precache ?? [])]
  const version = crypto
    .createHash('sha256')
    .update(JSON.stringify({ files, userOptions }))
    .digest('hex')
    .slice(0, 12)

  const options = resolveOptions({
    name: config.app?.name,
    ...userOptions,
    icons,
    appleTouchIcon,
    offline,
    precache,
    version,
  })
  const registerWorker = production || options.dev

  const manifestJson = JSON.stringify(manifest(options), null, 2)
  const worker = registerWorker ? serviceWorker(options) : devServiceWorker()
  const head = headTags(options, { register: registerWorker })

  return {
    options,
    head,
    precache,
    // Registered on the router before pages, so these paths are never
    // taken by a page or the frontend.
    routes(router) {
      router.get('/manifest.webmanifest', (req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
        res.setHeader('Cache-Control', production ? 'public, max-age=3600' : 'no-cache')
        res.end(manifestJson)
      })
      router.get(options.swUrl, (req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        // Always revalidated, so a deploy reaches users on their next visit.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Service-Worker-Allowed', options.scope)
        res.end(worker)
      })
      if (!offline) {
        // The built-in offline page, so it can be previewed and precached.
        router.get('/_tylix/offline', (req, res) => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(offlinePage(options))
        })
      }
    },
  }
}
