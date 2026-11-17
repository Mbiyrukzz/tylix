import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function hasAppPermissions(baseDir) {
  for (const ext of ['ts', 'js']) {
    try {
      await fs.access(path.join(baseDir, 'app', `permissions.${ext}`))
      return true
    } catch {
      // try the next one
    }
  }
  return false
}

// An app has roles and permissions when it has app/permissions.{ts,js}
// exporting `permissions` (what `tylix make:permissions` writes). Returns
// that instance, or null.
export async function loadAppPermissions(baseDir) {
  for (const ext of ['ts', 'js']) {
    const file = path.join(baseDir, 'app', `permissions.${ext}`)
    try {
      await fs.access(file)
    } catch {
      continue
    }
    const mod = await import(pathToFileURL(file).href)
    const permissions = mod.permissions ?? mod.default ?? null
    if (!permissions || typeof permissions.access !== 'function') {
      throw new Error(`app/permissions.${ext} must export \`permissions\` (from createPermissions() in @tylix/permissions).`)
    }
    return permissions
  }
  return null
}

// Wraps the /api/me handler so the user it returns carries `access`: the
// roles and permissions the browser checks with can() and hasRole(). The
// SSR session is read through the same route, so server-rendered pages get
// it too.
export function withAccess(permissions, handler) {
  if (!permissions) return handler
  return (req, res) => {
    const json = res.json.bind(res)
    res.json = async (body) => {
      const ok = (res.statusCode ?? 200) < 300
      if (ok && body && typeof body === 'object' && !Array.isArray(body) && body.id != null) {
        try {
          body = { ...body, access: await permissions.access(body) }
        } catch (err) {
          console.error('[permissions] could not load access for /api/me:', err)
        }
      }
      return json(body)
    }
    return handler(req, res)
  }
}
