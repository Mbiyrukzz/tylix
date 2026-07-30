import fs from 'node:fs/promises'
import path from 'node:path'

// A component package (like tylix-icons) ships a manifest at its
// root mapping exported names to the .tyx file that defines them:
//   { "IconCheck": "icons/IconCheck.tyx", "IconTrash": "icons/IconTrash.tyx" }
// This keeps resolution to "read one JSON file, then read the .tyx
// files it points at" -- no bundler, no special package.json export
// map, just a plain manifest a package author (or a scaffolding tool)
// can hand-write.
const MANIFEST_FILE = 'tylix-components.json'

export async function resolvePackageComponents(imports, baseDir) {
  const components = {}

  for (const { names, package: pkgName } of imports) {
    const pkgDir = path.join(baseDir, 'node_modules', pkgName)
    const manifestPath = path.join(pkgDir, MANIFEST_FILE)

    let manifest
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
    } catch {
      throw new Error(
        `Cannot resolve components from "${pkgName}": missing or invalid ${MANIFEST_FILE} in node_modules/${pkgName}. Is the package installed?`,
      )
    }

    for (const name of names) {
      const relPath = manifest[name]
      if (!relPath) {
        throw new Error(
          `"${pkgName}" does not export a component named "${name}" (checked ${MANIFEST_FILE})`,
        )
      }
      components[name] = await fs.readFile(path.join(pkgDir, relPath), 'utf-8')
    }
  }

  return components
}
