import fs from 'node:fs/promises'
import path from 'node:path'
import { extractImports } from './extractImports.js'

// A component package ships a manifest at its root mapping exported
// names to the .tyx file that defines them:
//   { "IconCheck": "icons/IconCheck.tyx" }
const MANIFEST_FILE = 'tylix-components.json'
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

const fileCache = new Map() // absolute path -> { mtimeMs, text }

async function readCached(file) {
  const stat = await fs.stat(file)
  const hit = fileCache.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.text
  const text = await fs.readFile(file, 'utf-8')
  fileCache.set(file, { mtimeMs: stat.mtimeMs, text })
  return text
}

// Walks up from startDir so packages hoisted into a workspace root
// resolve too. fs.stat follows symlinks (workspace-linked packages).
async function findPackageDir(pkgName, startDir) {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, 'node_modules', pkgName)
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// baseDir:  project root (local imports may not escape it).
// fromFile: absolute path of the importing .tyx file (relative
//           specifiers resolve against its folder).
// stack:    files currently being resolved, used to catch circular
//           imports. Internal: callers leave it out.
//
// Returns { [localTagName]: sourceText }. Each source has its own
// import lines already blanked out (line numbers kept), and whatever
// those imports pulled in (icons, other components) is included in the
// result under its own tag name, so a component can import other
// components and the page does not need to know about them.
export async function resolveImportedComponents(
  imports,
  { baseDir, fromFile = null, stack = [] },
) {
  const root = path.resolve(baseDir)
  const components = {}
  const owner = {}

  // The same name backed by the same text (two components both importing
  // IconArrowRight) is fine. Different text under one name is an error.
  const add = (local, text, from) => {
    if (Object.hasOwn(components, local)) {
      if (components[local] === text) return
      throw new Error(
        `Component "${local}" is provided by both ${owner[local]} and ${from}`,
      )
    }
    components[local] = text
    owner[local] = from
  }

  // Strips a component file's own imports, resolves them relative to that
  // file, adds what they provide to the result, and returns the cleaned
  // source.
  const expand = async (text, file, label) => {
    let extracted
    try {
      extracted = extractImports(text)
    } catch (err) {
      err.message = `In ${label}: ${err.message}`
      throw err
    }

    if (extracted.imports.length > 0) {
      const nested = await resolveImportedComponents(extracted.imports, {
        baseDir,
        fromFile: file,
        stack: [...stack, file],
      })
      for (const [name, nestedText] of Object.entries(nested)) {
        add(name, nestedText, label)
      }
    }

    return extracted.source
  }

  for (const imp of imports) {
    if (imp.kind === 'local') {
      if (!fromFile) {
        throw new Error(
          `Cannot resolve "${imp.specifier}" (line ${imp.line}): the importing file's path was not provided`,
        )
      }
      let file = path.resolve(path.dirname(fromFile), imp.specifier)
      if (!path.extname(file)) file += '.tyx'
      if (!file.startsWith(root + path.sep)) {
        throw new Error(
          `Import "${imp.specifier}" (line ${imp.line}) points outside the project`,
        )
      }
      if (stack.includes(file)) {
        throw new Error(
          `Circular import: ${[...stack, file].map((f) => path.relative(root, f)).join(' -> ')}`,
        )
      }

      let text
      try {
        text = await readCached(file)
      } catch {
        throw new Error(
          `Cannot find component file for "${imp.specifier}" imported at line ${imp.line} (looked for ${file})`,
        )
      }

      const source = await expand(text, file, path.relative(root, file))
      add(imp.names[0].local, source, file)
      continue
    }

    // package import
    if (!PACKAGE_NAME_RE.test(imp.specifier)) {
      throw new Error(`Invalid package name "${imp.specifier}" in import`)
    }
    const pkgDir = await findPackageDir(imp.specifier, root)
    if (!pkgDir) {
      throw new Error(
        `Cannot resolve components from "${imp.specifier}": not found in node_modules (searched from ${root} upwards). Is it installed?`,
      )
    }

    let manifest
    try {
      manifest = JSON.parse(await readCached(path.join(pkgDir, MANIFEST_FILE)))
    } catch {
      throw new Error(
        `Cannot resolve components from "${imp.specifier}": missing or invalid ${MANIFEST_FILE} in ${pkgDir}`,
      )
    }

    for (const { imported, local } of imp.names) {
      if (
        !Object.hasOwn(manifest, imported) ||
        typeof manifest[imported] !== 'string'
      ) {
        throw new Error(
          `"${imp.specifier}" does not export a component named "${imported}" (checked ${MANIFEST_FILE})`,
        )
      }
      const file = path.resolve(pkgDir, manifest[imported])
      if (!file.startsWith(pkgDir + path.sep)) {
        throw new Error(
          `"${imp.specifier}" maps "${imported}" outside its own directory (${manifest[imported]})`,
        )
      }
      if (stack.includes(file)) {
        throw new Error(`Circular import: ${[...stack, file].join(' -> ')}`)
      }

      const label = `${imp.specifier}:${imported}`
      const source = await expand(await readCached(file), file, label)
      add(local, source, label)
    }
  }

  return components
}

// One call for the whole job: strip the import lines and load what
// they point at.
export async function collectImports(source, options) {
  const { imports, source: cleaned } = extractImports(source)
  const components =
    imports.length > 0 ? await resolveImportedComponents(imports, options) : {}
  return { source: cleaned, components }
}