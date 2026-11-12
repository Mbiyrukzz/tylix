import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage, loadConfig, loadEnv } from '@tylix/shared'
import { pageFiles, registerRoute, routeFile, IMPORTS_MARKER, ROUTES_MARKER } from '../frontend/generateFiles.js'

const STARTER_TEMPLATE = (name) => `page ${name}

state
  count: 0

computed
  doubled() {
    return this.count * 2
  }

action
  increment() {
    this.count = this.count + 1
  }

template
  <div>
    <h1>${name}</h1>
    <p>Count: {{ count }}, doubled: {{ doubled }}</p>
    <button onclick="{{ increment }}">+1</button>
  </div>

style
  h1 { font-family: sans-serif; }
`

// What each frontend's route file contains when the project has auth, so
// --auth can refuse early in a project without it.
const AUTH_HELPER = {
  react: 'RequireAuth',
  vue: 'beforeEach',
  svelte: "access === 'auth'",
  angular: 'authGuard',
}

async function exists(file) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

// The project's frontend and language, for the make:* commands.
export async function projectFrontend(baseDir) {
  await loadEnv(baseDir)
  const language = await detectLanguage(baseDir)
  const config = await loadConfig(baseDir, language)
  return { driver: config.frontend.driver, ts: language === 'typescript' }
}

async function makeNativePage(baseDir, name) {
  const filePath = path.join(baseDir, 'app', 'pages', `${name}.tyx`)
  if (await exists(filePath)) {
    throw new Error(`${path.relative(baseDir, filePath)} already exists.`)
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, STARTER_TEMPLATE(path.basename(name)))
  console.log(`\n✔ Page created: ${path.relative(baseDir, filePath)}\n`)
}

// tylix make:page <Name> [--auth]
// Native projects get a .tyx page (the file name is its URL). Hosted
// frontends get a page in their own format, plus its route and import in
// the route file, at the tylix:imports / tylix:routes markers.
export async function makePage(name, { auth = false } = {}) {
  const baseDir = process.cwd()
  const { driver, ts } = await projectFrontend(baseDir)

  if (driver === 'tylix') {
    if (auth) console.log('Note: --auth is for hosted frontends; protect .tyx pages with middleware.')
    return makeNativePage(baseDir, name)
  }

  const frontendDir = path.join(baseDir, 'app', 'frontend')
  const page = pageFiles(driver, name, { ts })
  const pagePath = path.join(frontendDir, page.file)
  const routesPath = path.join(frontendDir, routeFile(driver, ts))
  const rel = (p) => path.relative(baseDir, p)

  if (await exists(pagePath)) throw new Error(`${rel(pagePath)} already exists.`)

  let routes = null
  if (await exists(routesPath)) routes = await fs.readFile(routesPath, 'utf-8')
  if (auth && routes && !routes.includes(AUTH_HELPER[driver])) {
    throw new Error(`--auth needs authentication in this project (${rel(routesPath)} has no ${AUTH_HELPER[driver]}).`)
  }

  await fs.mkdir(path.dirname(pagePath), { recursive: true })
  await fs.writeFile(pagePath, page.content)
  console.log(`\n✔ Page created: ${rel(pagePath)}`)

  const result = routes ? registerRoute(routes, page, { auth }) : { missing: 'route file' }
  if (result.source) {
    await fs.writeFile(routesPath, result.source)
    console.log(`✔ Route added:  ${page.name.routePath}${auth ? ' (logged-in users only)' : ''} in ${rel(routesPath)}`)
    if (auth) {
      console.log(
        `\n  To also redirect guests on the server, add "${page.name.routePath}" to frontend.protected in tylix.config.`,
      )
    }
    console.log()
    return
  }

  // An older project without the markers, or a conflict: show what to add.
  const reason = result.conflict ?? `${rel(routesPath)} has no "${result.missing}" marker`
  console.log(`\n  Couldn't add the route automatically: ${reason}.`)
  console.log(`  Add these to ${rel(routesPath)}:\n`)
  console.log(`    ${page.importLine}`)
  console.log(`    ${page.routeLine(auth)}\n`)
  console.log(`  (New projects mark the spots with "${IMPORTS_MARKER}" and "${ROUTES_MARKER}" comments.)\n`)
}
