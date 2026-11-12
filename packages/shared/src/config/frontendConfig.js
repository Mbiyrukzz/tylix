// The `frontend` section of tylix.config: which frontend renders pages, and
// how Tylix serves it. Normalised here once, so the CLI, the dev server and
// the build all read the same, validated values.

// Every frontend Tylix can serve. "tylix" is the native .tyx compiler; the
// others are hosted through Vite by the matching @tylix/<driver> package.
export const FRONTEND_DRIVERS = ['tylix', 'react', 'svelte', 'vue', 'angular']

const DEFAULTS = {
  driver: 'tylix',
  // Server-side rendering, for hosted frontends.
  ssr: false,
  // Page paths guests are redirected away from, to loginPath?next=...
  protected: [],
  loginPath: '/login',
  // Extra Vite config for hosted frontends, merged last.
  vite: {},
}

function fail(field, message) {
  throw new Error(`tylix.config: frontend.${field} ${message}`)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Fills in defaults and checks every field, so a mistake is reported by
// name when the app starts instead of silently doing nothing.
export function resolveFrontendConfig(frontend = {}) {
  if (frontend === undefined || frontend === null) frontend = {}
  if (!isPlainObject(frontend)) {
    throw new Error('tylix.config: frontend must be an object, e.g. { driver: "react" }.')
  }

  const known = new Set(Object.keys(DEFAULTS))
  for (const key of Object.keys(frontend)) {
    if (!known.has(key)) {
      fail(key, `is not a frontend option. Use: ${[...known].join(', ')}.`)
    }
  }

  const config = { ...DEFAULTS, ...frontend }

  if (!FRONTEND_DRIVERS.includes(config.driver)) {
    fail('driver', `"${config.driver}" is unknown. Use one of: ${FRONTEND_DRIVERS.join(', ')}.`)
  }
  if (typeof config.ssr !== 'boolean') {
    fail('ssr', `must be true or false, got ${JSON.stringify(config.ssr)}.`)
  }
  if (config.ssr && config.driver === 'tylix') {
    fail('ssr', 'is for hosted frontends (react, svelte, vue, angular). Native .tyx pages are always rendered on the server.')
  }
  if (!Array.isArray(config.protected) || config.protected.some((p) => typeof p !== 'string' || !p.startsWith('/'))) {
    fail('protected', 'must be a list of paths starting with "/", e.g. ["/dashboard/**"].')
  }
  if (typeof config.loginPath !== 'string' || !config.loginPath.startsWith('/')) {
    fail('loginPath', 'must be a path starting with "/", e.g. "/login".')
  }
  if (!isPlainObject(config.vite)) {
    fail('vite', 'must be an object of Vite options.')
  }

  return { ...config, protected: [...config.protected] }
}

// Identity helper for typed config files:
//   export default defineConfig({ frontend: { driver: 'react', ssr: true } })
export function defineConfig(config) {
  return config
}
