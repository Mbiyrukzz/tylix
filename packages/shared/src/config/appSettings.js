// The app, server and channels sections of the config: everything the
// server used to read straight from process.env, in one place, parsed and
// checked once. Each value comes from (lowest to highest) the default, the
// tylix.config file, then the environment (.env files or the shell).
//
// A value that can't be used (PORT=abc, CSP_MODE=strict) stops the app
// with a message naming the variable, instead of silently falling back.

import { envSource } from './loadEnv.js'

export const CSP_MODES = ['off', 'report-only', 'enforce']
export const LOG_LEVELS = ['debug', 'info', 'notice', 'warn', 'warning', 'error', 'critical', 'alert', 'emergency', 'silent']

function raw(name) {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function invalid(label, expected, value) {
  return new Error(`Config: ${label} must be ${expected}, got ${JSON.stringify(value)}.`)
}

const parsers = {
  string: (value) => String(value),
  boolean(value, label) {
    if (typeof value === 'boolean') return value
    const text = String(value).trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(text)) return true
    if (['false', '0', 'no', 'off'].includes(text)) return false
    throw invalid(label, 'true or false', value)
  },
  port(value, label) {
    const number = Number(value)
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw invalid(label, 'a port number (1-65535)', value)
    return number
  },
  positiveInteger(value, label) {
    const number = Number(value)
    if (!Number.isInteger(number) || number < 1) throw invalid(label, 'a whole number above 0', value)
    return number
  },
  list(value, label) {
    if (Array.isArray(value)) return value.map(String)
    if (typeof value !== 'string') throw invalid(label, 'a list', value)
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  },
  url(value, label) {
    try {
      return new URL(String(value)).toString().replace(/\/$/, '')
    } catch {
      throw invalid(label, 'a full URL such as https://example.com', value)
    }
  },
  nonNegativeInteger(value, label) {
    const number = Number(value)
    if (!Number.isInteger(number) || number < 0) throw invalid(label, 'a whole number, 0 or more', value)
    return number
  },
  logLevel(value, label) {
    const level = String(value).trim().toLowerCase()
    if (!LOG_LEVELS.includes(level)) throw invalid(label, LOG_LEVELS.join(', '), value)
    return level
  },
  logFormat(value, label) {
    const format = String(value).trim().toLowerCase()
    if (format !== 'json' && format !== 'pretty') throw invalid(label, 'json or pretty', value)
    return format
  },
  // true, false, or "api" (only /api/ requests).
  accessLog(value, label) {
    if (String(value).trim().toLowerCase() === 'api') return 'api'
    return parsers.boolean(value, label)
  },
  storeDriver(value, label) {
    const driver = String(value).trim().toLowerCase()
    if (!['memory', 'database', 'redis'].includes(driver)) throw invalid(label, 'memory, database or redis', value)
    return driver
  },
  // A number of processes, or "auto" for one per CPU core.
  workers(value, label) {
    if (String(value).trim().toLowerCase() === 'auto') return 'auto'
    return parsers.positiveInteger(value, label)
  },
  cspMode(value, label) {
    const mode = String(value).trim().toLowerCase()
    if (!CSP_MODES.includes(mode)) throw invalid(label, CSP_MODES.join(', '), value)
    return mode
  },
}

// One setting: the env variable wins, then the config file, then the
// default. Records where the value came from in `sources`.
function setting(sources, key, { env, fileValue, fallback, type }) {
  const parse = parsers[type]
  const fromEnv = env ? raw(env) : undefined
  if (fromEnv !== undefined) {
    sources[key] = { from: envSource(env) ?? 'environment', env }
    return parse(fromEnv, env)
  }
  if (fileValue !== undefined && fileValue !== null) {
    sources[key] = { from: 'tylix.config', env }
    return parse(fileValue, `tylix.config ${key}`)
  }
  sources[key] = { from: 'default', env }
  return typeof fallback === 'function' ? fallback() : fallback
}

export function resolveAppSettings(userConfig = {}, sources = {}) {
  const app = userConfig.app ?? {}
  const server = userConfig.server ?? {}
  const csp = server.csp ?? {}
  const channels = userConfig.channels ?? {}

  // NODE_ENV=production is what "tylix start" sets; APP_ENV can name any
  // environment (local, staging, production).
  const env = setting(sources, 'app.env', {
    env: raw('APP_ENV') !== undefined ? 'APP_ENV' : 'NODE_ENV',
    fileValue: app.env,
    fallback: 'development',
    type: 'string',
  })
  const production = env === 'production' || process.env.NODE_ENV === 'production'

  const resolvedApp = {
    name: setting(sources, 'app.name', { env: 'APP_NAME', fileValue: app.name, fallback: 'Tylix', type: 'string' }),
    env,
    production,
    debug: setting(sources, 'app.debug', { env: 'APP_DEBUG', fileValue: app.debug, fallback: false, type: 'boolean' }),
    url: setting(sources, 'app.url', { env: 'APP_URL', fileValue: app.url, fallback: undefined, type: 'url' }),
  }

  const resolvedServer = {
    port: setting(sources, 'server.port', { env: 'PORT', fileValue: server.port, fallback: 3000, type: 'port' }),
    // Try the next port when this one is taken. Off in production, where a
    // proxy or process manager expects a fixed port.
    autoPort: setting(sources, 'server.autoPort', {
      env: 'AUTO_PORT',
      fileValue: server.autoPort,
      fallback: !production,
      type: 'boolean',
    }),
    portAttempts: setting(sources, 'server.portAttempts', {
      env: 'PORT_ATTEMPTS',
      fileValue: server.portAttempts,
      fallback: 10,
      type: 'positiveInteger',
    }),
    // Believe X-Forwarded-* headers. Only behind a proxy you control.
    trustProxy: setting(sources, 'server.trustProxy', {
      env: 'TRUST_PROXY',
      fileValue: server.trustProxy,
      fallback: false,
      type: 'boolean',
    }),
    // Other origins allowed to make browser write requests. APP_URL is
    // always allowed.
    trustedOrigins: setting(sources, 'server.trustedOrigins', {
      env: 'TRUSTED_ORIGINS',
      fileValue: server.trustedOrigins,
      fallback: () => [],
      type: 'list',
    }),
    // Processes "tylix start" runs, sharing the port: a number, or "auto"
    // for one per CPU core.
    workers: setting(sources, 'server.workers', { env: 'WORKERS', fileValue: server.workers, fallback: 1, type: 'workers' }),
    maxBodyBytes: setting(sources, 'server.maxBodyBytes', {
      env: 'MAX_BODY_BYTES',
      fileValue: server.maxBodyBytes,
      fallback: 1024 * 1024,
      type: 'positiveInteger',
    }),
    csp: {
      mode: setting(sources, 'server.csp.mode', {
        env: 'CSP_MODE',
        fileValue: csp.mode,
        fallback: production ? 'report-only' : 'off',
        type: 'cspMode',
      }),
      policy: setting(sources, 'server.csp.policy', {
        env: 'CSP_POLICY',
        fileValue: csp.policy,
        // Unset: the server's built-in policy.
        fallback: undefined,
        type: 'string',
      }),
    },
  }

  const observability = userConfig.observability ?? {}
  const resolvedObservability = {
    logLevel: setting(sources, 'observability.logLevel', { env: 'LOG_LEVEL', fileValue: observability.logLevel, fallback: 'info', type: 'logLevel' }),
    // JSON lines for log collectors in production, readable lines otherwise.
    logFormat: setting(sources, 'observability.logFormat', {
      env: 'LOG_FORMAT',
      fileValue: observability.logFormat,
      fallback: production ? 'json' : 'pretty',
      type: 'logFormat',
    }),
    accessLog: setting(sources, 'observability.accessLog', {
      env: 'ACCESS_LOG',
      fileValue: observability.accessLog,
      fallback: production ? true : 'api',
      type: 'accessLog',
    }),
    slowRequestMs: setting(sources, 'observability.slowRequestMs', {
      env: 'SLOW_REQUEST_MS',
      fileValue: observability.slowRequestMs,
      fallback: 1000,
      type: 'nonNegativeInteger',
    }),
    slowQueryMs: setting(sources, 'observability.slowQueryMs', {
      env: 'SLOW_QUERY_MS',
      fileValue: observability.slowQueryMs,
      fallback: 200,
      type: 'nonNegativeInteger',
    }),
    // Prometheus metrics at /metrics.
    metrics: setting(sources, 'observability.metrics', { env: 'METRICS', fileValue: observability.metrics, fallback: false, type: 'boolean' }),
    // When set, /metrics needs "Authorization: Bearer <token>"; when not,
    // it answers only requests from this machine.
    metricsToken: setting(sources, 'observability.metricsToken', {
      env: 'METRICS_TOKEN',
      fileValue: observability.metricsToken,
      fallback: undefined,
      type: 'string',
    }),
  }

  const store = userConfig.store ?? {}
  const resolvedStore = {
    // Where rate limits, the cache and channel messages live. "database"
    // (default) shares them between processes through the app's database;
    // "redis" is faster for heavy traffic; "memory" is one process only.
    driver: setting(sources, 'store.driver', { env: 'STORE_DRIVER', fileValue: store.driver, fallback: 'database', type: 'storeDriver' }),
    redisUrl: setting(sources, 'store.redisUrl', { env: 'REDIS_URL', fileValue: store.redisUrl, fallback: 'redis://127.0.0.1:6379', type: 'string' }),
    prefix: setting(sources, 'store.prefix', {
      env: 'STORE_PREFIX',
      fileValue: store.prefix,
      fallback: `${String(resolvedApp.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}:`,
      type: 'string',
    }),
  }

  // Log channels, as in Laravel (see @tylix/core logging.js). LOG_CHANNEL
  // picks the default channel, LOG_STACK the channels the "stack" channel
  // writes to, LOG_DAILY_DAYS how long daily files are kept.
  const logging = userConfig.logging ?? {}
  const userChannels = logging.channels ?? {}
  const resolvedLogging = {
    default: setting(sources, 'logging.default', { env: 'LOG_CHANNEL', fileValue: logging.default, fallback: 'stack', type: 'string' }),
    channels: { ...userChannels },
  }
  const stack = setting(sources, 'logging.stack', {
    env: 'LOG_STACK',
    fileValue: userChannels.stack?.channels,
    fallback: () => ['console', 'daily'],
    type: 'list',
  })
  resolvedLogging.channels.stack = { driver: 'stack', ...userChannels.stack, channels: stack }
  const days = setting(sources, 'logging.days', {
    env: 'LOG_DAILY_DAYS',
    fileValue: userChannels.daily?.days,
    fallback: 14,
    type: 'nonNegativeInteger',
  })
  resolvedLogging.channels.daily = { driver: 'daily', path: 'storage/logs/tylix.log', ...userChannels.daily, days }

  const resolvedChannels = {
    port: setting(sources, 'channels.port', { env: 'CHANNELS_PORT', fileValue: channels.port, fallback: 6001, type: 'port' }),
  }

  return {
    app: resolvedApp,
    server: resolvedServer,
    channels: resolvedChannels,
    observability: resolvedObservability,
    logging: resolvedLogging,
    store: resolvedStore,
  }
}
