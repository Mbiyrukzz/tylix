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

export const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' }
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

export function createLogger(options = {}) {
  const settings = {
    level: options.level ?? 'info',
    format: options.format ?? 'pretty',
    stream: options.stream ?? process.stdout,
    errorStream: options.errorStream ?? options.stream ?? process.stderr,
    colors: options.colors ?? Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined),
    // Batch writes (see above). Tests pass false to read lines at once.
    buffer: options.buffer ?? true,
  }

  function make(base) {
    function write(level, message, fields = {}) {
      if (LOG_LEVELS[level] < LOG_LEVELS[settings.level]) return
      const requestId = currentRequest()?.requestId
      const all = { ...base, ...(requestId ? { requestId } : {}), ...fields }
      const target = LOG_LEVELS[level] >= LOG_LEVELS.warn ? settings.errorStream : settings.stream
      const emit = settings.buffer ? (text) => buffered(target, text) : (text) => target.write(text)
      if (settings.format === 'json') {
        emit(JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...plain(all) }) + '\n')
        return
      }
      const time = new Date().toTimeString().slice(0, 8)
      const label = level.toUpperCase().padEnd(5)
      const tag = settings.colors ? `${COLORS[level]}${label}${RESET}` : label
      const extras = Object.entries(all)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${prettyValue(value)}`)
        .join(' ')
      emit(`${time} ${tag} ${message}${extras ? `  ${extras}` : ''}\n`)
    }
    return {
      debug: (message, fields) => write('debug', message, fields),
      info: (message, fields) => write('info', message, fields),
      warn: (message, fields) => write('warn', message, fields),
      error: (message, fields) => write('error', message, fields),
      child: (fields) => make({ ...base, ...fields }),
      isLevelEnabled: (level) => LOG_LEVELS[level] >= LOG_LEVELS[settings.level],
      // Changes this logger and every child of it.
      configure(next = {}) {
        for (const key of Object.keys(settings)) if (next[key] !== undefined) settings[key] = next[key]
        if (next.stream && next.errorStream === undefined) settings.errorStream = next.stream
      },
    }
  }
  if (!(settings.level in LOG_LEVELS)) throw new Error(`Unknown log level "${settings.level}".`)
  return make(options.base ?? {})
}

// The app's logger. "tylix dev" and "tylix start" configure it from
// LOG_LEVEL / LOG_FORMAT; import it anywhere.
export const logger = createLogger({
  level: process.env.LOG_LEVEL in LOG_LEVELS ? process.env.LOG_LEVEL : 'info',
  format: process.env.LOG_FORMAT === 'json' ? 'json' : 'pretty',
})
