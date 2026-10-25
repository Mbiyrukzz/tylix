import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|session/i
const MAX_BODY_CHARS = 4000
const MAX_LINE_CHARS = 300

function redact(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value
  if (depth > 5) return '[too deep]'
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  const out = {}
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(val, depth + 1)
  }
  return out
}

function shorten(file, cwd) {
  const relative = path.relative(cwd, file)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : file
}

// Matches both "at fn (file:1:2)" and "at file:1:2".
const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/

export function parseStack(stack = '', cwd = process.cwd()) {
  const frames = []
  for (const line of String(stack).split('\n')) {
    const match = FRAME.exec(line)
    if (!match) continue
    let [, fn, file, lineNo, column] = match
    if (file.startsWith('file://')) {
      try {
        file = fileURLToPath(file)
      } catch {
        /* keep the raw value */
      }
    }
        const internal = file.startsWith('node:')
    const framework =
      !internal &&
      (file.includes('node_modules') ||
        /[\\/]tylix[\\/]packages[\\/]/.test(file) ||
        file.includes('@tylix'))
    const vendor = framework
    frames.push({
      fn: fn || null,
      file,
      short: internal ? file : shorten(file, cwd),
      line: Number(lineNo),
      column: Number(column),
      kind: internal ? 'internal' : vendor ? 'vendor' : 'app',
    })
  }
  return frames
}

function readSource(frame) {
  try {
    const lines = fs.readFileSync(frame.file, 'utf8').split('\n')
    const start = Math.max(1, frame.line - 5)
    const end = Math.min(lines.length, frame.line + 5)
    return {
      file: frame.short,
      line: frame.line,
      column: frame.column,
      start,
      lines: lines.slice(start - 1, end).map((l) => l.slice(0, MAX_LINE_CHARS)),
    }
  } catch {
    return null
  }
}

function bodyToString(body) {
  if (body == null || body === '') return null
  let text
  try {
    text = typeof body === 'string' ? body : JSON.stringify(redact(body), null, 2)
  } catch {
    return '[unserializable body]'
  }
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}… (${text.length} chars)`
    : text
}

export function buildDebugPayload(err, req, { status = 500 } = {}) {
  const cwd = process.cwd()
  const isDbError = err?.name === 'DatabaseError' && typeof err.toJSON === 'function'
  const db = isDbError ? err.toJSON() : {}
  const frames = parseStack(err?.stack, cwd)
  const firstApp = frames.find((f) => f.kind === 'app')

  return {
    status,
    name: err?.name || 'Error',
    message: err?.message ?? String(err),
    title: db.title ?? null,
    hint: db.hint ?? null,
    kind: db.kind ?? null,
    driver: db.driver ?? null,
    code: db.code ?? err?.code ?? null,
    detail: db.detail ?? null,
    table: db.table ?? null,
    column: db.column ?? null,
    sql: db.sql ?? null,
    params: db.params ?? [],
    cause: err?.cause
      ? {
          name: err.cause.name ?? 'Error',
          message: err.cause.sqlMessage || err.cause.message || String(err.cause),
          code: err.cause.code ?? null,
        }
      : null,
    frames,
    source: firstApp ? readSource(firstApp) : null,
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip ?? null,
      headers: redact({ ...req.headers }),
      query: redact(req.query ?? {}),
      params: redact(req.params ?? {}),
      body: bodyToString(req.body),
    },
    env: {
      node: process.version,
      platform: process.platform,
      nodeEnv: process.env.NODE_ENV || 'development',
      cwd,
    },
  }
}