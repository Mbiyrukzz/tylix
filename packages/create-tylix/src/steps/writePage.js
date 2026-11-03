import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

// Every page except Home resolves to exactly one template regardless
// of config -- Home is the exception, see resolveTemplateName below.
const STATIC_TEMPLATE_BY_PAGE = {
  Login: 'login-page.tyx.template',
  Register: 'register-page.tyx.template',
  Dashboard: 'dashboard-page.tyx.template',
  'dashboard/Mail': 'mail-page.tyx.template',
  'posts/Index': 'posts-index-page.tyx.template',
  'posts/[id]': 'posts-detail-page.tyx.template',
  _not_found: 'not-found-page.tyx.template',
}

// Page keys whose file name differs from the key.
const FILE_NAME_BY_PAGE = { _not_found: '_not-found' }

// Home depends on two things:
//   - the Blank starter has no landing components, so it gets a page
//     that imports nothing;
//   - otherwise, the auth variant does `uses Auth` and reads
//     `Auth.user`, and that capability only exists when
//     config.authEnabled is true (see writeCapabilities.js).
function resolveTemplateName(config, pageName) {
  if (pageName === 'Home') {
    if (config.starter !== 'starter') return 'home-page-blank.tyx.template'
    return config.authEnabled
      ? 'home-page.tyx.template'
      : 'home-page-noauth.tyx.template'
  }
  return STATIC_TEMPLATE_BY_PAGE[pageName]
}

export async function writePage(config, pageName) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const templateName = resolveTemplateName(config, pageName)
  if (!templateName) {
    throw new Error(`No template registered for page "${pageName}"`)
  }

  const content = await fs.readFile(
    path.join(PACKAGE_ROOT, 'src', 'templates', templateName),
    'utf-8',
  )

  const outputPath = path.join(
    targetDir,
    'app',
    'pages',
    `${FILE_NAME_BY_PAGE[pageName] ?? pageName}.tyx`,
  )

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, content)
}

export async function writeLayout(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const templateName = config.authEnabled
    ? 'layout.tyx.template'
    : 'layout-noauth.tyx.template'
  const raw = await fs.readFile(
    path.join(PACKAGE_ROOT, 'src', 'templates', templateName),
    'utf-8',
  )

  // The Posts link only makes sense when the public posts pages exist.
  const showPosts = config.starter === 'starter' && config.authEnabled
  const content = raw.replaceAll('__SHOW_POSTS__', String(showPosts))

  await fs.writeFile(
    path.join(targetDir, 'app', 'pages', '_layout.tyx'),
    content,
  )
}