import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { detectLanguage } from '@tylix/shared'

export async function loadCustomRoutes(router, baseDir) {
  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'
  const routesPath = path.join(baseDir, 'app', 'routes', `web.${ext}`)

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
