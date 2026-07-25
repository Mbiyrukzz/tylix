import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loadCustomRoutes(router, baseDir) {
  const routesPath = path.join(baseDir, 'app', 'routes', 'web.js')
  const exists = await fs
    .access(routesPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return false

  const mod = await import(pathToFileURL(routesPath).href)
  if (typeof mod.routes === 'function') {
    await mod.routes(router)
  }
  return true
}
