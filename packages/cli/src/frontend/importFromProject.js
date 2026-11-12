import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Imports a package the way code inside the project would, from the
// project's node_modules, not from wherever the Tylix CLI is installed.
//
// Frontend tooling (vite, @vitejs/plugin-react) belongs to the project.
// Importing it relative to the CLI would load nothing (it's not a CLI
// dependency) or, with linked packages, a second copy.
//
// Node has no stable "resolve from this directory" API for ESM-only
// packages (createRequire can't see "import"-only exports), so this
// reads the package's exports map itself. It supports the forms real
// packages use: a string, condition objects, and exact subpaths.

const CONDITIONS = ['node', 'import', 'module', 'default']

function splitSpecifier(specifier) {
  const parts = specifier.split('/')
  const nameLength = specifier.startsWith('@') ? 2 : 1
  const name = parts.slice(0, nameLength).join('/')
  const rest = parts.slice(nameLength).join('/')
  return { name, subpath: rest ? `./${rest}` : '.' }
}

function pickTarget(target) {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) {
    for (const item of target) {
      const picked = pickTarget(item)
      if (picked) return picked
    }
    return null
  }
  if (target && typeof target === 'object') {
    for (const condition of CONDITIONS) {
      if (condition in target) {
        const picked = pickTarget(target[condition])
        if (picked) return picked
      }
    }
  }
  return null
}

export function resolveExport(pkg, subpath) {
  const { exports } = pkg
  if (exports === undefined) {
    if (subpath !== '.') return subpath
    return pkg.module ?? pkg.main ?? './index.js'
  }

  // "exports": "./index.js" or a condition object with no subpaths.
  const isSubpathMap =
    exports && typeof exports === 'object' && !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith('.'))
  if (!isSubpathMap) return subpath === '.' ? pickTarget(exports) : null

  if (subpath in exports) return pickTarget(exports[subpath])

  // "./features/*": "./src/features/*.js"
  for (const [key, value] of Object.entries(exports)) {
    const star = key.indexOf('*')
    if (star === -1) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const match = subpath.slice(prefix.length, subpath.length - suffix.length)
      const target = pickTarget(value)
      return target ? target.replaceAll('*', match) : null
    }
  }
  return null
}

async function findPackageDir(name, fromDir) {
  let dir = path.resolve(fromDir)
  while (true) {
    const candidate = path.join(dir, 'node_modules', name)
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

export async function resolveFromProject(baseDir, specifier) {
  const { name, subpath } = splitSpecifier(specifier)
  const pkgDir = await findPackageDir(name, baseDir)
  if (!pkgDir) return null

  const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf-8'))
  const target = resolveExport(pkg, subpath)
  if (!target) {
    throw new Error(`"${specifier}" is not exported by ${name}.`)
  }
  return path.join(pkgDir, target)
}

export function createProjectImporter(baseDir) {
  return async function importFromProject(specifier) {
    const file = await resolveFromProject(baseDir, specifier)
    if (!file) {
      const err = new Error(
        `Cannot find "${specifier}" in this project. Install it with "npm install ${specifier}".`,
      )
      err.code = 'TYLIX_MISSING_PACKAGE'
      err.specifier = specifier
      throw err
    }
    return import(pathToFileURL(file).href)
  }
}
