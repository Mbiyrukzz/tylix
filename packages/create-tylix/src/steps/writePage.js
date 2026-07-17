import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

const TEMPLATE_BY_PAGE = {
  Home: 'home-page.tyx.template',
  Login: 'login-page.tyx.template',
  Register: 'register-page.tyx.template',
  Dashboard: 'dashboard-page.tyx.template',
}

export async function writePage(config, pageName) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const templateName = TEMPLATE_BY_PAGE[pageName]
  if (!templateName)
    throw new Error(`No template registered for page "${pageName}"`)

  const content = await fs.readFile(
    path.join(PACKAGE_ROOT, 'src', 'templates', templateName),
    'utf-8',
  )
  await fs.writeFile(
    path.join(targetDir, 'app', 'pages', `${pageName}.tyx`),
    content,
  )
}

export async function writeLayout(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const content = await fs.readFile(
    path.join(PACKAGE_ROOT, 'src', 'templates', 'layout.tyx.template'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(targetDir, 'app', 'pages', '_layout.tyx'),
    content,
  )
}
