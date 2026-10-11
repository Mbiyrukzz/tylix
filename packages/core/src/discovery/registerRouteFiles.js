import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { requireAuth } from '../http/requireAuth.js'

const ROUTE_FILE = /\.(js|ts)$/
// .d.ts files, _private files, dotfiles, and web.* (already loaded by loadCustomRoutes)
const SKIP = /(\.d\.ts$|^_|^\.|^web\.(js|ts)$)/

async function collect(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = []

  for (const entry of entries) {
    if (SKIP.test(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collect(full)))
    else if (entry.isFile() && ROUTE_FILE.test(entry.name)) files.push(full)
  }

  return files.sort()
}

// Mounts every app/routes/**/*.{js,ts} file exporting routes(router, { auth }).
export async function registerRouteFiles(router, baseDir, { secret } = {}) {
  const routesDir = path.join(baseDir, 'app', 'routes')
  const context = { auth: (handler) => requireAuth(handler, secret) }
  const mounted = []

  for (const file of await collect(routesDir)) {
    const mod = await import(pathToFileURL(file).href)

    if (typeof mod.routes !== 'function') {
      console.warn(`⚠ ${path.relative(baseDir, file)} has no routes() export, skipped`)
      continue
    }

    await mod.routes(router, context)
    mounted.push(path.relative(baseDir, file))
  }

  return mounted
}