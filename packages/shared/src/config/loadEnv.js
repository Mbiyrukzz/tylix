import fs from 'node:fs/promises'
import path from 'node:path'

// Loads .env files into process.env. Files are read in this order, and the
// first one that sets a key wins:
//
//   .env.<mode>.local   machine-specific overrides for one environment
//   .env.local          machine-specific overrides (not loaded in tests)
//   .env.<mode>         settings for one environment (production, test…)
//   .env                shared defaults
//
// <mode> is APP_ENV, else NODE_ENV, else "development" ("tylix start" sets
// NODE_ENV=production). A variable already set in the shell always wins
// over every file.
//
// Syntax, as in other .env tools:
//   KEY=value                  # a comment after a space is ignored
//   export KEY=value           # works with `source .env` too
//   KEY='literal $HOME \n'     # single quotes: exactly as written
//   KEY="line one\nline two"   # double quotes: \n \r \t \" \\ escapes
//   KEY="first line
//   second line"               # double quotes may span lines
//   URL=${APP_URL}/api         # ${VAR} and ${VAR:-default} expand
//                              # (not inside single quotes)

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

// Key -> the file that set it, for every key a file has set in this process.
const sources = new Map()

// Which .env file set `key`, or undefined when no file did (unset, or set
// in the shell).
export function envSource(key) {
  return sources.get(key)
}

export function envFiles(mode) {
  return [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env']
}

const ESCAPES = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }

function expand(value, lookup) {
  return value.replace(/(\\?)\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (match, escaped, name, fallback) => {
    if (escaped) return match.slice(1)
    const found = lookup(name)
    return found === undefined || found === '' ? (fallback ?? '') : found
  }).replace(/\\\$/g, '$')
}

// Parses .env text into [key, value, kind] entries, in file order. `kind`
// says how the value was written, which decides whether it expands.
export function parseEnv(text) {
  const entries = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '')
    if (!KEY_PATTERN.test(key)) continue

    let rest = trimmed.slice(eq + 1).trim()
    const quote = rest[0]
    if (quote === "'" || quote === '"') {
      // Find the closing quote, continuing onto following lines if needed.
      let body = rest.slice(1)
      let close = findClose(body, quote)
      while (close === -1 && i + 1 < lines.length) {
        body += '\n' + lines[++i]
        close = findClose(body, quote)
      }
      if (close === -1) {
        entries.push([key, rest, 'plain']) // unterminated: keep as written
        continue
      }
      const inner = body.slice(0, close)
      if (quote === "'") entries.push([key, inner, 'literal'])
      // \$ stays escaped until expansion, which turns it into a plain $.
      else entries.push([key, inner.replace(/\\([nrt"\\])/g, (_, c) => ESCAPES[c]), 'expand'])
      continue
    }
    // Unquoted: a # after whitespace starts a comment.
    const comment = rest.search(/\s#/)
    if (comment !== -1) rest = rest.slice(0, comment).trimEnd()
    entries.push([key, rest, 'expand'])
  }
  return entries
}

function findClose(body, quote) {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === '\\') {
      i++
      continue
    }
    if (body[i] === quote) return i
  }
  return -1
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export async function loadEnv(baseDir = process.cwd()) {
  const base = await readIfExists(path.join(baseDir, '.env'))
  const baseEntries = base === null ? [] : parseEnv(base)
  const baseValue = (name) => baseEntries.findLast(([key]) => key === name)?.[1]
  const mode = process.env.APP_ENV || process.env.NODE_ENV || baseValue('APP_ENV') || 'development'

  // Highest precedence first: a key is taken from the first file that has it.
  const chosen = new Map()
  for (const file of envFiles(mode)) {
    const text = file === '.env' ? base : await readIfExists(path.join(baseDir, file))
    if (text === null) continue
    const entries = file === '.env' ? baseEntries : parseEnv(text)
    const seenHere = new Map()
    for (const [key, value, kind] of entries) seenHere.set(key, { value, kind, file }) // last one in a file wins
    for (const [key, entry] of seenHere) if (!chosen.has(key)) chosen.set(key, entry)
  }

  // Keys the shell set (and keys an earlier load set) are left alone.
  const apply = []
  for (const [key, entry] of chosen) {
    if (key in process.env) continue
    apply.push([key, entry])
  }

  const resolving = new Set()
  const resolved = new Map()
  const lookup = (name) => {
    if (name in process.env) return process.env[name]
    if (resolved.has(name)) return resolved.get(name)
    const entry = chosen.get(name)
    if (!entry || resolving.has(name)) return undefined // unknown, or a cycle
    resolving.add(name)
    const value = entry.kind === 'expand' ? expand(entry.value, lookup) : entry.value
    resolving.delete(name)
    resolved.set(name, value)
    return value
  }

  for (const [key, entry] of apply) {
    const value = lookup(key)
    process.env[key] = value
    sources.set(key, entry.file)
  }
}
