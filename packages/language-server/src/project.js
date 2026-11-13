// What the server knows about the app a .tyx file belongs to.
//
// The project root is the nearest folder above the file that has a
// tylix.config.{js,ts,mjs} (or, failing that, a package.json). Nothing
// in the project is executed: compiler options are read from the config
// text, and the project's own @tylix/compiler is only loaded when the
// editor says the workspace is trusted.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const CONFIG_NAMES = ['tylix.config.ts', 'tylix.config.js', 'tylix.config.mjs']

export function findProjectRoot(file) {
  let dir = path.dirname(file)
  let fallback = null
  for (;;) {
    if (CONFIG_NAMES.some((n) => fs.existsSync(path.join(dir, n)))) return dir
    if (!fallback && fs.existsSync(path.join(dir, 'package.json'))) fallback = dir
    const parent = path.dirname(dir)
    if (parent === dir) return fallback ?? path.dirname(file)
    dir = parent
  }
}

// `compiler: { not: 'loose' }` read out of the config text.
export function readCompilerOptions(root) {
  for (const name of CONFIG_NAMES) {
    let text
    try {
      text = fs.readFileSync(path.join(root, name), 'utf-8')
    } catch {
      continue
    }
    const block = /compiler\s*:\s*\{([^}]*)\}/.exec(text)
    const not = block && /\bnot\s*:\s*['"`](loose|tight)['"`]/.exec(block[1])
    return not ? { not: not[1] } : {}
  }
  return {}
}

export function isTypeScriptProject(root) {
  return (
    fs.existsSync(path.join(root, 'tsconfig.json')) ||
    fs.existsSync(path.join(root, 'tylix.config.ts'))
  )
}

// app/useApi/*.ts with module syntax blanked, for the typechecker
// (the same input `tylix dev` gives it).
export function readApiHelpers(root) {
  const dir = path.join(root, 'app', 'useApi')
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return ''
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) =>
      fs
        .readFileSync(path.join(dir, e.name), 'utf-8')
        .replace(/^[ \t]*import\s[^\n]*$/gm, '')
        .replace(/^([ \t]*)export\s+(default\s+)?/gm, '$1'),
    )
    .join('\n\n')
}

// The project's own @tylix/compiler when trusted and new enough (so the
// editor parses exactly like the app's build), else the bundled one.
export async function loadCompiler(root, { trusted }) {
  if (trusted) {
    try {
      const req = createRequire(path.join(root, 'package.json'))
      const entry = req.resolve('@tylix/compiler')
      const mod = await import(pathToFileURL(entry).href)
      if (typeof mod.diagnoseTyx === 'function') return { compiler: mod, source: entry }
    } catch {
      // not installed, or too old to have diagnoseTyx
    }
  }
  // Just the diagnostics module: the package index also loads the page
  // renderer, which reads runtime files from disk as it loads (and
  // those are not inside the editor bundle).
  const mod = await import('@tylix/compiler/src/diagnostics/diagnose.js')
  return { compiler: mod, source: 'bundled' }
}

export function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.tyx`]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

// name -> { file, text, symbols } for app/capabilities/*.tyx, cached
// per file by modification time. `openText(file)` returns unsaved
// editor text for a file, if it is open.
export function createCapabilityIndex(root, diagnoseTyx, openText = () => null) {
  const cache = new Map() // file -> { mtimeMs, text, entry }
  return function capabilities() {
    const dir = path.join(root, 'app', 'capabilities')
    const out = new Map()
    let files = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.tyx'))
    } catch {
      return out
    }
    for (const f of files) {
      const file = path.join(dir, f)
      let text = openText(file)
      let entry
      if (text === null) {
        const mtimeMs = fs.statSync(file).mtimeMs
        const hit = cache.get(file)
        if (hit && hit.mtimeMs === mtimeMs) entry = hit.entry
        else {
          text = fs.readFileSync(file, 'utf-8')
          entry = analyseCapability(file, text, diagnoseTyx)
          cache.set(file, { mtimeMs, entry })
        }
      } else {
        entry = analyseCapability(file, text, diagnoseTyx)
      }
      if (entry) out.set(entry.name, entry)
    }
    return out
  }
}

function analyseCapability(file, text, diagnoseTyx) {
  const { kind, name, symbols } = diagnoseTyx(text)
  return kind === 'capability' ? { name, file, text, symbols } : null
}
