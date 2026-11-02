import { findSectionBoundaries } from '../parser/parsePageFile.js'
//   import { A, B as C } from "pkg"   -> components from a package manifest
//   import Card from "./a/Card"       -> one local .tyx file, named by you
//
// `[ \t\r]*` at the ends (never `\s*`) so a match can't swallow
// neighbouring blank lines; `[^}]*` lets the braces span lines.
const IMPORT_LINE_RE =
  /^[ \t]*import(?:\s*\{([^}]*)\}|\s+([A-Za-z_$][\w$]*))\s*from\s*["']([^"']+)["']\s*;?[ \t\r]*$/gm

const NAME_RE = /^[A-Z][A-Za-z0-9_$]*$/
const NAMED_ITEM_RE =
  /^([A-Z][A-Za-z0-9_$]*)(?:\s+as\s+([A-Z][A-Za-z0-9_$]*))?$/

// Imports are only recognised BEFORE the template, so code samples
// inside <pre> blocks are never rewritten.
function headEnd(source) {
  const sectionTemplate = findSectionBoundaries(source).find(
    (b) => b.keyword === 'template',
  )
  const legacy = source.search(/<template[\s>]/)
  const ends = [sectionTemplate ? sectionTemplate.start : -1, legacy].filter(
    (n) => n >= 0,
  )
  return ends.length > 0 ? Math.min(...ends) : source.length
}

// Each removed import is replaced by the SAME number of newlines, so
// every line below it keeps its original line number (parse errors
// and typecheck diagnostics depend on that).
//
// Returns { imports, source } where each import is
//   { kind: 'package' | 'local', specifier, line,
//     names: [{ imported, local }] }
// `local` is the tag name the page uses; `imported` is the name in
// the package manifest (null for local files, which hold one
// component each).
export function extractImports(source) {
  const end = headEnd(source)
  const head = source.slice(0, end)
  const packages = new Map() // specifier -> import entry
  const locals = []
  const taken = new Map() // local name -> specifier

  const claim = (local, specifier, line) => {
    if (taken.has(local) && taken.get(local) !== specifier) {
      throw new Error(
        `"${local}" is imported twice (from "${taken.get(local)}" and "${specifier}", line ${line}); give one of them a different name`,
      )
    }
    taken.set(local, specifier)
  }

  const cleaned = head.replace(
    IMPORT_LINE_RE,
    (match, braced, bare, specifier, offset) => {
      const line = head.slice(0, offset).split('\n').length

      if (specifier.startsWith('/')) {
        throw new Error(
          `Absolute import "${specifier}" at line ${line} is not supported; use a relative path`,
        )
      }

      if (specifier.startsWith('.')) {
        if (braced !== undefined) {
          throw new Error(
            `Line ${line}: a local file holds one component, so write: import Name from "${specifier}"`,
          )
        }
        if (!NAME_RE.test(bare)) {
          throw new Error(
            `Line ${line}: component name "${bare}" must start with an uppercase letter`,
          )
        }
        claim(bare, specifier, line)
        locals.push({
          kind: 'local',
          specifier,
          line,
          names: [{ imported: null, local: bare }],
        })
      } else {
        if (bare !== undefined) {
          throw new Error(
            `Line ${line}: packages export named components, so write: import { ${bare} } from "${specifier}"`,
          )
        }
        let entry = packages.get(specifier)
        if (!entry) {
          entry = { kind: 'package', specifier, line, names: [] }
          packages.set(specifier, entry)
        }
        for (const raw of braced.split(',').map((n) => n.trim()).filter(Boolean)) {
          const m = NAMED_ITEM_RE.exec(raw)
          if (!m) {
            throw new Error(
              `Line ${line}: cannot import "${raw}" from "${specifier}" (expected Name or Name as Other, PascalCase)`,
            )
          }
          const imported = m[1]
          const local = m[2] ?? m[1]
          claim(local, specifier, line)
          entry.names.push({ imported, local })
        }
      }

      return match.replace(/[^\n]/g, '') // keep the newlines only
    },
  )

  return {
    imports: [...packages.values(), ...locals],
    source: cleaned + source.slice(end),
  }
}