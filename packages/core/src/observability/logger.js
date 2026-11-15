import fs from 'node:fs'
import { currentRequest } from './context.js'

// A small structured logger.
//
//   logger.info('Invoice sent', { invoiceId: 12 })
//   const log = logger.child({ job: 'SendInvoice' }); log.warn('Retrying')
//
// In production (LOG_FORMAT=json) each entry is one JSON line, ready for
// a log collector; in development it is one readable line. Entries made
// while a request is handled carry its requestId, which is also sent to
// the client as X-Request-Id, so a user's report can be matched to logs.

// The eight RFC 5424 levels Laravel uses, plus "silent". "warning" is the
// same level as "warn".
export const LOG_LEVELS = {
  debug: 10,
  info: 20,
  notice: 25,
  warn: 30,
  warning: 30,
  error: 40,
  critical: 50,
  alert: 60,
  emergency: 70,
  silent: 100,
}

const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  notice: '\x1b[34m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  critical: '\x1b[1;31m',
  alert: '\x1b[1;35m',
  emergency: '\x1b[1;41m',
}
const RESET = '\x1b[0m'

// Lines are collected and written in one batch per turn of the event
// loop: writing to stdout is synchronous for files and pipes, and one
// write per line would cost every request a system call. Anything left is
// written synchronously when the process exits, so no line is lost.
const buffers = new Map()

function flush(stream) {
  const lines = buffers.get(stream)
  if (!lines?.length) return
  buffers.set(stream, [])
  stream.write(lines.join(''))
}

function flushAllSync() {
  for (const [stream, lines] of buffers) {
    if (!lines.length) continue
    const text = lines.join('')
    buffers.set(stream, [])
    const fd = stream === process.stdout ? 1 : stream === process.stderr ? 2 : null
    try {
      if (fd !== null) fs.writeSync(fd, text)
      else stream.write(text)
    } catch {
      // stdout closed: nothing more to do
    }
  }
}
process.on('exit', flushAllSync)

function buffered(stream, text) {
  let lines = buffers.get(stream)
  if (!lines) buffers.set(stream, (lines = []))
  lines.push(text)
  if (lines.length === 1) setImmediate(flush, stream)
  else if (lines.length >= 1000) flush(stream)
}

function serializeError(err) {
  if (!(err instanceof Error)) return err
  return { name: err.name, message: err.message, stack: err.stack, ...(err.code ? { code: err.code } : {}) }
}

function plain(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) out[key] = value instanceof Error ? serializeError(value) : value
  return out
}

function prettyValue(value) {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value
  return JSON.stringify(value)
}

// Writes entries to stdout/stderr, as one readable line or one JSON line.
// It reads the logger's settings on every entry, so configure() applies.
function consoleTransport(settings) {
  return {
    name: 'console',
    write(entry) {
      const target = entry.toStderr || LOG_LEVELS[entry.level] >= LOG_LEVELS.warn ? settings.errorStream : settings.stream
      const emit = settings.buffer ? (text) => buffered(target, text) : (text) => target.write(text)
      if (settings.format === 'json') {
        emit(JSON.stringify({ time: entry.time.toISOString(), level: entry.level, msg: entry.message, ...plain(entry.fields) }) + '\n')
        return
      }
      const time = entry.time.toTimeString().slice(0, 8)
      const label = entry.level.toUpperCase().padEnd(5)
      const tag = settings.colors ? `${COLORS[entry.level]}${label}${RESET}` : label
      const extras = Object.entries(entry.fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${prettyValue(value)}`)
        .join(' ')
      emit(`${time} ${tag} ${entry.message}${extras ? `  ${extras}` : ''}\n`)
    },
  }
}

// "warning" is written as "warn", so a level has one name in the output.
const canonical = (level) => (level === 'warning' ? 'warn' : level)

export function createLogger(options = {}) {
  const settings = {
    level: options.level ?? 'info',
    format: options.format ?? 'pretty',
    stream: options.stream ?? process.stdout,
    errorStream: options.errorStream ?? options.stream ?? process.stderr,
    colors: options.colors ?? Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined),
    // Batch writes (see above). Tests pass false to read lines at once.
    buffer: options.buffer ?? true,
    // Where entries go: the console unless the logging config (Log
    // channels, see logging.js) says otherwise.
    transports: options.transports ?? null,
    // Fields added to every entry of this logger and its children
    // (Log.withContext).
    context: {},
  }
  const console_ = consoleTransport(settings)
  const defaultTransports = () => settings.transports ?? [console_]

  function make(base, pick = defaultTransports) {
    function write(level, message, fields = {}) {
      level = canonical(level)
      if (LOG_LEVELS[level] < LOG_LEVELS[settings.level]) return
      const requestId = currentRequest()?.requestId
      const entry = {
        time: new Date(),
        level,
        message: String(message),
        fields: { ...settings.context, ...base, ...(requestId ? { requestId } : {}), ...(fields ?? {}) },
      }
      for (const transport of pick()) {
        if (transport.level && LOG_LEVELS[level] < LOG_LEVELS[transport.level]) continue
        try {
          transport.write(entry)
        } catch (err) {
          // A broken channel must never break the request that logged.
          reportTransportFailure(transport, err)
        }
      }
    }
    const log = {
      debug: (message, fields) => write('debug', message, fields),
      info: (message, fields) => write('info', message, fields),
      notice: (message, fields) => write('notice', message, fields),
      warn: (message, fields) => write('warn', message, fields),
      warning: (message, fields) => write('warn', message, fields),
      error: (message, fields) => write('error', message, fields),
      critical: (message, fields) => write('critical', message, fields),
      alert: (message, fields) => write('alert', message, fields),
      emergency: (message, fields) => write('emergency', message, fields),
      // log('warning', 'Disk almost full')
      log(level, message, fields) {
        if (!(canonical(level) in LOG_LEVELS) || level === 'silent') throw new Error(`Unknown log level "${level}".`)
        write(level, message, fields)
      },
      child: (fields) => make({ ...base, ...fields }, pick),
      // The same logger, writing to other transports (Log.channel()).
      withTransports: (transports) => make(base, () => transports),
      // Adds fields to every later entry of this logger and its children.
      withContext(fields = {}) {
        Object.assign(settings.context, fields)
        return log
      },
      withoutContext(keys) {
        if (!keys) settings.context = {}
        else for (const key of keys) delete settings.context[key]
        return log
      },
      isLevelEnabled: (level) => LOG_LEVELS[canonical(level)] >= LOG_LEVELS[settings.level],
      // Changes this logger and every child of it.
      configure(next = {}) {
        for (const key of Object.keys(settings)) if (next[key] !== undefined) settings[key] = next[key]
        if (next.stream && next.errorStream === undefined) settings.errorStream = next.stream
      },
      // The console writer, so a "console" log channel can reuse it.
      get consoleTransport() {
        return console_
      },
    }
    return log
  }
  if (!(settings.level in LOG_LEVELS)) throw new Error(`Unknown log level "${settings.level}".`)
  return make(options.base ?? {})
}

const failedTransports = new WeakSet()
function reportTransportFailure(transport, err) {
  if (failedTransports.has(transport)) return
  failedTransports.add(transport)
  try {
    process.stderr.write(`[tylix] log channel "${transport.name ?? 'custom'}" failed: ${err?.message ?? err}\n`)
  } catch {
    // nowhere left to report it
  }
}

export { plain as plainLogFields, serializeError }

// The app's logger. "tylix dev" and "tylix start" configure it from
// LOG_LEVEL / LOG_FORMAT; import it anywhere.
export const logger = createLogger({
  level: process.env.LOG_LEVEL in LOG_LEVELS ? process.env.LOG_LEVEL : 'info',
  format: process.env.LOG_FORMAT === 'json' ? 'json' : 'pretty',
})
