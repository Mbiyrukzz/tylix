import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

// Imported by the layout, so they are written for every project,
// including the Blank starter. No-auth projects get a navbar that
// doesn't depend on the Auth capability.
const LAYOUT_COMPONENTS_AUTH = ['SiteNavbar', 'SiteFooter']
const LAYOUT_COMPONENTS_PUBLIC = ['SiteNavbarPublic', 'SiteFooter']

// Landing page sections, written for the Starter template.
const HOME_COMPONENTS = [
  'Hero',
  'InstallSnippet',
  'Stats',
  'FeatureGrid',
  'HowItWorks',
  'CTASection',
]

// Only make sense when auth and the Post feature exist.
const HOME_COMPONENTS_AUTH = ['LatestPosts', 'CreatePostForm']

const STARTER_ICONS = [
  // 'IconCheck',
  // 'IconX',
  // 'IconArrowRight',
  // 'IconHeart',
  // 'IconSearch',
  // 'IconMenu',
  // 'IconTrash',
]

async function copyComponent(componentsDir, name) {
  const content = await fs.readFile(
    path.join(
      PACKAGE_ROOT,
      'src',
      'templates',
      'components',
      `${name}.tyx.template`,
    ),
    'utf-8',
  )
  await fs.writeFile(path.join(componentsDir, `${name}.tyx`), content)
}

export async function writeComponents(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const componentsDir = path.join(targetDir, 'app', 'pages', 'components')
  const iconsDir = path.join(componentsDir, 'icons')
  await fs.mkdir(iconsDir, { recursive: true })

  for (const name of STARTER_ICONS) {
    const content = await fs.readFile(
      path.join(
        PACKAGE_ROOT,
        'src',
        'templates',
        'icons',
        `${name}.tyx.template`,
      ),
      'utf-8',
    )
    await fs.writeFile(path.join(iconsDir, `${name}.tyx`), content)
  }

  const layoutComponents = config.authEnabled
    ? LAYOUT_COMPONENTS_AUTH
    : LAYOUT_COMPONENTS_PUBLIC
  for (const name of layoutComponents) {
    await copyComponent(componentsDir, name)
  }

  if (config.starter !== 'starter') return

  for (const name of HOME_COMPONENTS) {
    await copyComponent(componentsDir, name)
  }
  if (config.authEnabled) {
    for (const name of HOME_COMPONENTS_AUTH) {
      await copyComponent(componentsDir, name)
    }
  }
}