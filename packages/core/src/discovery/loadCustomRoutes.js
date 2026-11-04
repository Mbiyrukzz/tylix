import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { detectLanguage } from '@tylix/shared'
import { requireAuth } from '../http/requireAuth.js'

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete'])

// Same symbol requireAuth sets on its handlers. authGuard below is not a
// requireAuth result, so it is marked here by hand.
const AUTH_MARK = Symbol.for('tylix.requireAuth')

// A view of the router where every route registered through it gets the
// `guards` middleware placed ahead of its own middleware and handler.
// Every method returns the scoped view, so chaining stays guarded.
function scopedRouter(router, guards) {
  const register = (method, pattern, ...handlers) => {
    if (handlers.length === 0) {
      throw new Error(
        `Router.${method.toLowerCase()}("${pattern}") needs a handler`,
      )
    }
    router.register(method, pattern, ...guards, ...handlers)
    return scoped
  }

  const scoped = new Proxy(router, {
    get(target, prop) {
      if (prop === 'register') return register
      if (typeof prop === 'string' && VERBS.has(prop)) {
        return (pattern, ...handlers) =>
          register(prop.toUpperCase(), pattern, ...handlers)
      }
      if (prop === 'use') {
        return () => {
          throw new Error(
            'router.use() is global middleware and cannot be called inside protectedRoutes(); call it in publicRoutes() or a plain routes() export instead.',
          )
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return scoped
}

// Loads app/routes/web.{ts,js}. It may export:
//   publicRoutes(router)     reachable by anyone
//   protectedRoutes(router)  every route requires a logged-in user
//   routes(router, { auth }) legacy: you wrap handlers yourself
// Returns true when the web file exists.
export async function loadCustomRoutes(router, baseDir, { secret, hydrate } = {}) {
  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'
  const routesPath = path.join(baseDir, 'app', 'routes', `web.${ext}`)

  const exists = await fs
    .access(routesPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return false

  const mod = await import(pathToFileURL(routesPath).href)
  const auth = (handler) => requireAuth(handler, secret, { hydrate })

  // Middleware form of requireAuth: runs first, and only calls next()
  // when the token is valid (requireAuth answers 401/500 itself otherwise).
  const authGuard = (req, res, next) =>
    requireAuth(() => next(), secret, { hydrate })(req, res)
  authGuard[AUTH_MARK] = true

  let loaded = false

  if (typeof mod.publicRoutes === 'function') {
    await mod.publicRoutes(router)
    loaded = true
  }

  if (typeof mod.protectedRoutes === 'function') {
    if (!secret) {
      throw new Error(
        'protectedRoutes() needs auth.secret, but none is configured. Set AUTH_SECRET.',
      )
    }
    await mod.protectedRoutes(scopedRouter(router, [authGuard]))
    loaded = true
  }

  if (typeof mod.routes === 'function') {
    await mod.routes(router, { auth })
    loaded = true
  }

  if (!loaded) {
    console.warn(
      `⚠ app/routes/web.${ext} exports none of publicRoutes, protectedRoutes or routes, skipped`,
    )
  }

  return true
}