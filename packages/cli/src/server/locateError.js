// Finds where a dev-time compile error really is.
//
// Errors thrown while compiling a page say which file they came from
// only in their message ("In component <Card>: ...", "In
// app/capabilities/posts.tyx: ...", nested when one file pulls in
// another), and their "at line N" counts from the start of a section,
// not the file. This picks the innermost file named in the message,
// re-parses it with diagnoseTyx and returns exact positions:
//
//   [{ file, source, line, column, endLine, endColumn, message, origin }]
//
// or null when the error is not a .tyx syntax error we can place (the
// caller then falls back to the plain error page).
import fs from 'node:fs/promises'
import path from 'node:path'

const LABEL_RE = /In (component <([A-Za-z_$][\w$]*)>|[^:\n]+?\.tyx):/g
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build'])

async function walkTyx(dir, out = []) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walkTyx(full, out)
    } else if (entry.name.endsWith('.tyx')) {
      out.push(full)
    }
  }
  return out
}

async function readOrNull(file) {
  try {
    return await fs.readFile(file, 'utf-8')
  } catch {
    return null
  }
}

// The _layout.tyx files that wrap `pageFile`, nearest first.
function layoutChain(pageFile, appDir) {
  const out = []
  let dir = path.dirname(pageFile)
  while (dir.startsWith(appDir)) {
    out.push(path.join(dir, '_layout.tyx'))
    if (dir === appDir) break
    dir = path.dirname(dir)
  }
  return out
}

// Files the innermost label in `message` could mean, best guess first.
async function candidatesFor(message, { baseDir, pageFile, detectTyxKind }) {
  const appDir = path.join(baseDir, 'app')
  const labels = [...String(message).matchAll(LABEL_RE)]
  const innermost = labels.at(-1)
  if (!innermost) return pageFile ? [pageFile] : []

  const componentName = innermost[2]
  if (componentName) {
    const matches = []
    for (const file of await walkTyx(appDir)) {
      const base = path.basename(file, '.tyx')
      if (base === componentName) {
        matches.unshift(file)
        continue
      }
      const text = await readOrNull(file)
      if (text && detectTyxKind(text).name === componentName) matches.push(file)
    }
    return matches
  }

  const label = innermost[1].trim()
  if (path.basename(label) === '_layout.tyx' && !label.includes('/')) {
    return pageFile ? layoutChain(pageFile, appDir) : []
  }
  if (path.isAbsolute(label)) return [label]
  return [path.join(baseDir, label), path.join(appDir, label)]
}

export async function locateCompileError(err, { baseDir, pageFile, compilerOptions = {} }) {
  const { diagnoseTyx, detectTyxKind } = await import('@tylix/compiler')

  // Typecheck failures arrive already placed.
  if (Array.isArray(err?.diagnostics) && err.diagnostics.length > 0) {
    return err.diagnostics
  }

  const candidates = await candidatesFor(err?.message ?? '', {
    baseDir,
    pageFile,
    detectTyxKind,
  })
  for (const file of candidates) {
    const source = await readOrNull(file)
    if (source === null) continue
    const { diagnostics } = diagnoseTyx(source, { language: compilerOptions })
    if (diagnostics.length > 0) {
      return diagnostics.map((d) => ({ ...d, file, source }))
    }
  }
  return null
}
