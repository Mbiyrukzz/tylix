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
// Returns { [localTagName]: sourceText }.
export async function resolveImportedComponents(
  imports,
  { baseDir, fromFile = null },
) {
  const root = path.resolve(baseDir)
  const components = {}
  const owner = {}

  const add = (local, text, from) => {
    if (owner[local] && owner[local] !== from) {
      throw new Error(
        `Component "${local}" is provided by both ${owner[local]} and ${from}`,
      )
    }
    components[local] = text
    owner[local] = from
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
      let text
      try {
        text = await readCached(file)
      } catch {
        throw new Error(
          `Cannot find component file for "${imp.specifier}" imported at line ${imp.line} (looked for ${file})`,
        )
      }
      add(imp.names[0].local, text, file)
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
      add(local, await readCached(file), `${imp.specifier}:${imported}`)
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