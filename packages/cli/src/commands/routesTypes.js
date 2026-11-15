import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage, exists, resolveViewsDir } from '@tylix/shared'
import { generateRouteClient } from '../routes/routeTypes.js'

// Where the typed client goes. A hosted frontend gets the client next to
// its source (app/views/api.generated.ts); a native .tyx app gets the
// types in app/types/api.d.ts.
export async function routeClientTargets(baseDir, { hosted, language }) {
  if (hosted) {
    const dir = resolveViewsDir(baseDir)
    return language === 'typescript'
      ? [{ file: path.join(dir, 'api.generated.ts'), kind: 'ts' }]
      : [
          { file: path.join(dir, 'api.generated.js'), kind: 'js' },
          { file: path.join(dir, 'api.generated.d.ts'), kind: 'dts' },
        ]
  }
  return [{ file: path.join(baseDir, 'app', 'types', 'api.d.ts'), kind: 'dts' }]
}

// Writes the client for an app built by createApp. Only files whose
// content changed are written, so watchers don't fire for nothing.
// Returns the files that are (check: would be) out of date.
export async function writeRouteClient(baseDir, app, { check = false } = {}) {
  const language = await detectLanguage(baseDir)
  const hosted = app.frontend?.driver !== undefined && app.frontend.driver !== 'tylix'
  const generated = generateRouteClient({ routes: app.routes, features: app.features })
  const changed = []
  for (const target of await routeClientTargets(baseDir, { hosted, language })) {
    const content = generated[target.kind]
    const current = (await exists(target.file)) ? await fs.readFile(target.file, 'utf8') : null
    if (current === content) continue
    changed.push(path.relative(baseDir, target.file))
    if (check) continue
    await fs.mkdir(path.dirname(target.file), { recursive: true })
    await fs.writeFile(target.file, content)
  }
  return { changed, routes: generated.routes }
}

// tylix routes:types [--check]
export async function routesTypes({ check = false } = {}) {
  const baseDir = process.cwd()
  const { createApp } = await import('../server/createApp.js')
  // The real app, without its frontend: every API route, as registered.
  const app = await createApp(baseDir, { frontend: false })
  try {
    const { changed, routes } = await writeRouteClient(baseDir, app, { check })
    if (check) {
      if (changed.length) {
        console.error(`✘ The typed API client is out of date: ${changed.join(', ')}. Run "tylix routes:types".`)
        process.exitCode = 1
      } else console.log('✔ The typed API client is up to date.')
      return
    }
    console.log(changed.length ? `✔ Typed API client (${routes.length} routes): ${changed.join(', ')}` : `✔ Typed API client is up to date (${routes.length} routes).`)
  } finally {
    await app.close()
  }
}
