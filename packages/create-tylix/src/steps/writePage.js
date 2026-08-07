import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

// Every page except Home resolves to exactly one template regardless
// of config -- Home is the one exception, since its template depends
// on whether the Auth capability will actually exist (see
// resolveTemplateName below).
const STATIC_TEMPLATE_BY_PAGE = {
  Login: 'login-page.tyx.template',
  Register: 'register-page.tyx.template',
  Dashboard: 'dashboard-page.tyx.template',
  'dashboard/Mail': 'mail-page.tyx.template',
}

// Home.tyx's auth-enabled variant does `uses: Auth` and reads
// `Auth.user` -- that capability only gets scaffolded when
// config.authEnabled is true (see writeCapabilities.js), so a
// no-auth project needs a Home page that doesn't reference it at all.
function resolveTemplateName(config, pageName) {
  if (pageName === 'Home') {
    return config.authEnabled
      ? 'home-page.tyx.template'
      : 'home-page-noauth.tyx.template'
  }
  return STATIC_TEMPLATE_BY_PAGE[pageName]
}

export async function writePage(config, pageName) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const templateName = resolveTemplateName(config, pageName)
  if (!templateName)
    throw new Error(`No template registered for page "${pageName}"`)

  const content = await fs.readFile(
    path.join(PACKAGE_ROOT, 'src', 'templates', templateName),
    'utf-8',
  )
  const outputPath = path.join(targetDir, 'app', 'pages', `${pageName}.tyx`)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, content)
}

export async function writeLayout(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const templateName = config.authEnabled
    ? 'layout.tyx.template'
    : 'layout-noauth.tyx.template'
  const content = await fs.readFile(
    path.join(PACKAGE_ROOT, 'src', 'templates', templateName),
    'utf-8',
  )
  await fs.writeFile(
    path.join(targetDir, 'app', 'pages', '_layout.tyx'),
    content,
  )
}
