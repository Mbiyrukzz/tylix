// tylix check [paths...] [--typecheck | --no-typecheck] [--format=pretty|json|github]
//
// Parses (and, in TypeScript projects, typechecks) every .tyx file
// under app/ -- pages, components, layouts and capabilities -- and
// reports each problem with its file, line and column. Exits 1 when
// anything is wrong, so it can gate CI.
//
//   --format=github  prints GitHub Actions annotations, so errors show
//                    up inline on the pull request.
import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage, loadConfig, exists as pathExists } from '@tylix/shared'
import { stripModuleSyntax } from '../server/stripModuleSyntax.js'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.tylix'])

async function walkTyx(target, out = []) {
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) return out
  if (stat.isFile()) {
    if (target.endsWith('.tyx')) out.push(target)
    return out
  }
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    await walkTyx(path.join(target, entry.name), out)
  }
  return out
}

export async function loadApiHelpersForTypecheck(baseDir) {
  const apiDir = path.join(baseDir, 'app', 'useApi')
  if (!(await pathExists(apiDir))) return ''
  const sources = []
  for (const entry of await fs.readdir(apiDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      const raw = await fs.readFile(path.join(apiDir, entry.name), 'utf-8')
      sources.push(stripModuleSyntax(raw))
    }
  }
  return sources.join('\n\n')
}

// Project settings check needs: the compiler switches from tylix.config
// and whether to typecheck (TypeScript projects do, like `tylix dev`).
async function projectSettings(baseDir) {
  const language = await detectLanguage(baseDir)
  let compiler = {}
  let configError = null
  try {
    const config = await loadConfig(baseDir, language)
    compiler = config?.compiler ?? {}
  } catch (err) {
    configError = err
  }
  return { language, compiler, configError }
}

/**
 * Checks .tyx files and returns
 *   { files: [{ file, kind, diagnostics }], errorCount, checked }
 * without printing anything.
 */
export async function runCheck({
  baseDir = process.cwd(),
  paths = [],
  typecheck,
} = {}) {
  const { diagnoseTyx } = await import('@tylix/compiler')
  const settings = await projectSettings(baseDir)
  const doTypecheck = typecheck ?? settings.language === 'typescript'
  const apiHelpersSource = doTypecheck ? await loadApiHelpersForTypecheck(baseDir) : ''

  const roots = paths.length > 0 ? paths.map((p) => path.resolve(baseDir, p)) : [path.join(baseDir, 'app')]
  const files = []
  for (const root of roots) await walkTyx(root, files)
  files.sort()

  const results = []
  let errorCount = 0
  let checked = 0
  for (const file of files) {
    const source = await fs.readFile(file, 'utf-8')
    const { kind, diagnostics } = diagnoseTyx(source, {
      language: settings.compiler,
      typecheck: doTypecheck,
      apiHelpersSource,
    })
    if (kind === 'other') continue
    checked++
    errorCount += diagnostics.length
    results.push({ file, source, kind, diagnostics })
  }
  return { files: results, errorCount, checked, typecheck: doTypecheck, settings }
}

function escapeGithub(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export async function check(args = []) {
  const baseDir = process.cwd()
  const formatArg = args.find((a) => a.startsWith('--format='))
  const format = formatArg ? formatArg.slice('--format='.length) : 'pretty'
  if (!['pretty', 'json', 'github'].includes(format)) {
    console.error(`Unknown --format "${format}" (expected pretty, json or github)`)
    process.exit(1)
  }
  const typecheck = args.includes('--typecheck')
    ? true
    : args.includes('--no-typecheck')
      ? false
      : undefined
  const paths = args.filter((a) => !a.startsWith('--'))

  const { formatDiagnostic } = await import('@tylix/compiler')
  const result = await runCheck({ baseDir, paths, typecheck })
  const rel = (file) => path.relative(baseDir, file) || file

  if (format === 'json') {
    const out = result.files.flatMap((f) =>
      f.diagnostics.map(({ offset, ...d }) => ({ file: rel(f.file), ...d, offset })),
    )
    console.log(JSON.stringify(out, null, 2))
  } else if (format === 'github') {
    for (const f of result.files) {
      for (const d of f.diagnostics) {
        console.log(
          `::error file=${rel(f.file)},line=${d.line},col=${d.column},endLine=${d.endLine},endColumn=${d.endColumn},title=tylix ${d.origin}::${escapeGithub(d.message)}`,
        )
      }
    }
  } else {
    if (result.settings.configError) {
      console.log(`⚠ Could not load the project config (${result.settings.configError.message}); checking with default compiler options.`)
    }
    for (const f of result.files) {
      if (f.diagnostics.length === 0) continue
      console.log(`\n✘ ${rel(f.file)}`)
      for (const d of f.diagnostics) {
        console.log(
          formatDiagnostic(f.source, d, rel(f.file))
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n'),
        )
      }
    }
    const bad = result.files.filter((f) => f.diagnostics.length > 0).length
    const what = result.typecheck ? 'parsed and typechecked' : 'parsed'
    if (result.errorCount === 0) {
      console.log(`✔ ${result.checked} .tyx file(s) ${what}, no problems.`)
    } else {
      console.log(
        `\n${result.errorCount} problem(s) in ${bad} of ${result.checked} .tyx file(s) (${what}).`,
      )
    }
  }

  if (result.errorCount > 0) process.exitCode = 1
}
