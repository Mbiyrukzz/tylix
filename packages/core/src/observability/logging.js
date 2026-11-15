import fs from 'node:fs'
import path from 'node:path'
import { logger, LOG_LEVELS, plainLogFields } from './logger.js'

// Log channels, the way Laravel has them.
//
//   import { Log } from '@tylix/core'
//   Log.info('Invoice sent', { invoiceId: 12 })
//   Log.channel('payments').error('Charge failed', { error })
//   Log.stack(['daily', 'slack']).critical('Disk full')
//
// tylix.config:
//
//   logging: {
//     default: 'stack',                                   // LOG_CHANNEL
//     channels: {
//       stack:    { driver: 'stack', channels: ['console', 'daily'] },  // LOG_STACK
//       single:   { driver: 'single', path: 'storage/logs/tylix.log' },
//       daily:    { driver: 'daily', path: 'storage/logs/tylix.log', days: 14 },
//       console:  { driver: 'console' },
//       null:     { driver: 'null' },
//       payments: { driver: 'daily', path: 'storage/logs/payments.log', level: 'warning' },
//       slack:    { driver: 'custom', via: (config) => ({ write(entry) { ... } }) },
//     },
//   }
//
// File channels write one line per entry, like Laravel:
//
//   [2026-11-15 10:22:01] production.ERROR: Charge failed {"orderId":7} {"requestId":"..."}
//
// followed by the stack trace when the context holds an Error.

export const DEFAULT_LOG_PATH = 'storage/logs/tylix.log'

export const DEFAULT_LOG_CHANNELS = {
  stack: { driver: 'stack', channels: ['console', 'daily'] },
  single: { driver: 'single', path: DEFAULT_LOG_PATH },
  daily: { driver: 'daily', path: DEFAULT_LOG_PATH, days: 14 },
  console: { driver: 'console' },
  stderr: { driver: 'console', stream: 'stderr' },
  null: { driver: 'null' },
}

const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

// Splits an entry's fields into the context the caller passed and the
// extras Tylix adds (requestId), so the line reads like Laravel's.
const EXTRA_KEYS = new Set(['requestId'])

export function formatLogLine(entry, environment = 'local') {
  const context = {}
  const extra = {}
  const traces = []
  for (const [key, value] of Object.entries(entry.fields ?? {})) {
    if (value === undefined) continue
    if (value instanceof Error && value.stack) traces.push(value.stack)
    ;(EXTRA_KEYS.has(key) ? extra : context)[key] = value
  }
  const json = (fields) => (Object.keys(fields).length ? JSON.stringify(plainLogFields(fields)) : '[]')
  let line = `[${localTime(entry.time)}] ${environment}.${entry.level === 'warn' ? 'WARNING' : entry.level.toUpperCase()}: ${entry.message} ${json(context)} ${json(extra)}\n`
  for (const trace of traces) line += `[stacktrace]\n${trace}\n`
  return line
}

// Appends to a file, batched once per turn of the event loop. What is left
// at exit is written synchronously, so no line is lost on a crash.
const pendingFiles = new Map()
let exitHookInstalled = false

function flushFile(file) {
  const lines = pendingFiles.get(file)
  if (!lines?.length) return
  pendingFiles.set(file, [])
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, lines.join(''))
}

export function flushLogFiles() {
  for (const file of pendingFiles.keys()) {
    try {
      flushFile(file)
    } catch {
      // the disk went away: nothing more to do at exit
    }
  }
}

function appendLine(file, text, onError) {
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.on('exit', flushLogFiles)
  }
  let lines = pendingFiles.get(file)
  if (!lines) pendingFiles.set(file, (lines = []))
  lines.push(text)
  if (lines.length === 1) {
    setImmediate(() => {
      try {
        flushFile(file)
      } catch (err) {
        onError(err)
      }
    })
  }
}

// Deletes app-YYYY-MM-DD.log files older than `days` days.
function pruneDailyFiles(basePath, days) {
  if (!days || days < 1) return
  const dir = path.dirname(basePath)
  const ext = path.extname(basePath)
  const stem = path.basename(basePath, ext)
  const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4}-\\d{2}-\\d{2})${ext.replace('.', '\\.')}$`)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const oldest = localDate(cutoff)
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const match = pattern.exec(name)
    if (match && match[1] <= oldest) {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch {
        // already gone
      }
    }
  }
}

export function dailyLogPath(basePath, date = new Date()) {
  const ext = path.extname(basePath)
  return path.join(path.dirname(basePath), `${path.basename(basePath, ext)}-${localDate(date)}${ext}`)
}

function fileTransport(name, file, { environment, level, daily = false, days = 14, format = 'line' }) {
  let lastDay = null
  const transport = {
    name,
    level,
    path: file,
    daily,
    write(entry) {
      let target = file
      if (daily) {
        target = dailyLogPath(file, entry.time)
        const day = localDate(entry.time)
        if (day !== lastDay) {
          lastDay = day
          pruneDailyFiles(file, days)
        }
      }
      const text =
        format === 'json'
          ? JSON.stringify({ time: entry.time.toISOString(), env: environment, level: entry.level, msg: entry.message, ...plainLogFields(entry.fields) }) + '\n'
          : formatLogLine(entry, environment)
      appendLine(target, text, (err) => reportFileFailure(name, target, err))
    },
  }
  return transport
}

// A file that can't be written (read-only disk, no permission) is
// reported once on stderr; the app keeps running and other channels still
// get every entry.
const reportedFiles = new Set()
function reportFileFailure(channel, file, err) {
  if (reportedFiles.has(file)) return
  reportedFiles.add(file)
  try {
    process.stderr.write(`[tylix] log channel "${channel}" can't write ${file}: ${err?.message ?? err}\n`)
  } catch {
    // nowhere left to report it
  }
}

const customDrivers = new Map()

function buildChannel(name, channels, context, seen = new Set()) {
  const config = channels[name]
  if (!config) throw new Error(`Log channel "${name}" is not defined. Add it to logging.channels in tylix.config, or use one of: ${Object.keys(channels).join(', ')}.`)
  if (seen.has(name)) throw new Error(`Log channel "${name}" includes itself.`)
  const level = config.level
  if (level !== undefined && !(level in LOG_LEVELS)) throw new Error(`Log channel "${name}": unknown level "${level}".`)
  const resolve = (file) => path.resolve(context.baseDir, file ?? DEFAULT_LOG_PATH)

  switch (config.driver) {
    case 'stack': {
      const names = config.channels ?? []
      const next = new Set(seen).add(name)
      const members = names.flatMap((member) => buildChannel(member, channels, context, next))
      return level ? members.map((t) => ({ ...t, write: t.write, level: maxLevel(t.level, level) })) : members
    }
    case 'single':
      return [fileTransport(name, resolve(config.path), { environment: context.environment, level, format: config.format })]
    case 'daily':
      return [
        fileTransport(name, resolve(config.path), {
          environment: context.environment,
          level,
          daily: true,
          days: config.days ?? 14,
          format: config.format,
        }),
      ]
    case 'console': {
      const base = logger.consoleTransport
      if (!level && config.stream !== 'stderr') return [base]
      return [
        {
          name,
          level,
          write: (entry) => base.write(config.stream === 'stderr' ? { ...entry, toStderr: true } : entry),
        },
      ]
    }
    case 'null':
      return []
    case 'custom': {
      if (typeof config.via !== 'function') throw new Error(`Log channel "${name}": a custom channel needs via: (config) => ({ write(entry) {} }).`)
      return [wrapCustom(name, config.via(config, context), level)]
    }
    default: {
      const factory = customDrivers.get(config.driver)
      if (!factory) {
        throw new Error(
          `Log channel "${name}": unknown driver "${config.driver}". Use stack, single, daily, console, null or custom, or register one with Log.extend().`,
        )
      }
      return [wrapCustom(name, factory(config, context), level)]
    }
  }
}

function maxLevel(a, b) {
  if (!a) return b
  return LOG_LEVELS[a] >= LOG_LEVELS[b] ? a : b
}

function wrapCustom(name, made, level) {
  const write = typeof made === 'function' ? made : made?.write?.bind(made)
  if (typeof write !== 'function') throw new Error(`Log channel "${name}" must return a function or { write(entry) }.`)
  return { name, level: maxLevel(made?.level, level), write }
}

// The resolved logging settings, set by configureLogging().
const state = {
  channels: DEFAULT_LOG_CHANNELS,
  defaultChannel: null,
  context: { baseDir: process.cwd(), environment: 'local' },
  cache: new Map(),
}

function channelTransports(name) {
  if (!state.cache.has(name)) state.cache.set(name, buildChannel(name, state.channels, state.context))
  return state.cache.get(name)
}

// Reads config.logging and points the app logger at its default channel.
// Called by "tylix dev", "tylix start" and the workers. Until it runs, the
// logger writes to the console only.
export function configureLogging(settings = {}, { baseDir = process.cwd(), environment = 'local' } = {}) {
  state.channels = { ...DEFAULT_LOG_CHANNELS, ...(settings.channels ?? {}) }
  state.context = { baseDir, environment }
  state.cache = new Map()
  const defaultChannel = settings.default ?? 'stack'
  if (settings.stack && state.channels.stack?.driver === 'stack' && !settings.channels?.stack) {
    state.channels.stack = { ...state.channels.stack, channels: settings.stack }
  }
  state.defaultChannel = defaultChannel
  logger.configure({ transports: channelTransports(defaultChannel) })
  return { default: defaultChannel, transports: channelTransports(defaultChannel) }
}

// Every file the configured channels write to, for "tylix log:tail".
export function logFiles() {
  const files = []
  for (const name of Object.keys(state.channels)) {
    let transports
    try {
      transports = channelTransports(name)
    } catch {
      continue
    }
    for (const t of transports) {
      if (!t.path) continue
      const file = t.daily ? dailyLogPath(t.path) : t.path
      if (!files.some((f) => f.path === file)) files.push({ channel: t.name ?? name, path: file, base: t.path, daily: t.daily })
    }
  }
  return files
}

export const Log = {
  debug: (message, context) => logger.debug(message, context),
  info: (message, context) => logger.info(message, context),
  notice: (message, context) => logger.notice(message, context),
  warning: (message, context) => logger.warning(message, context),
  warn: (message, context) => logger.warn(message, context),
  error: (message, context) => logger.error(message, context),
  critical: (message, context) => logger.critical(message, context),
  alert: (message, context) => logger.alert(message, context),
  emergency: (message, context) => logger.emergency(message, context),
  log: (level, message, context) => logger.log(level, message, context),

  // A logger that writes to one named channel only.
  channel(name) {
    return logger.withTransports(channelTransports(name))
  },

  // A logger that writes to several channels at once.
  stack(names) {
    return logger.withTransports(names.flatMap((name) => channelTransports(name)))
  },

  // A logger for a channel defined on the spot:
  //   Log.build({ driver: 'single', path: 'storage/logs/import.log' })
  build(config) {
    const name = config.name ?? 'on-demand'
    return logger.withTransports(buildChannel(name, { ...state.channels, [name]: config }, state.context))
  },

  // Fields added to every later entry, on every channel.
  withContext(context) {
    logger.withContext(context)
    return Log
  },
  withoutContext(keys) {
    logger.withoutContext(keys)
    return Log
  },

  // Registers a driver: Log.extend('slack', (config) => ({ write(entry) {...} }))
  // then logging.channels.alerts = { driver: 'slack', url: ... }.
  extend(driver, factory) {
    if (typeof factory !== 'function') throw new Error('Log.extend(driver, factory): factory must be a function.')
    customDrivers.set(driver, factory)
    state.cache = new Map()
    if (state.defaultChannel) logger.configure({ transports: channelTransports(state.defaultChannel) })
    return Log
  },

  // Writes pending file lines now (tests, before exiting a script).
  flush: flushLogFiles,
}
