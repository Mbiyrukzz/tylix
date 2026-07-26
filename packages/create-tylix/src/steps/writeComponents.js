import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

const HOME_COMPONENTS = [
  'Hero',
  'InstallSnippet',
  'Stats',
  'FeatureGrid',
  'Testimonials',
  'CTASection',
  'SiteFooter',
]

const STARTER_ICONS = [
  'IconCheck',
  'IconX',
  'IconArrowRight',
  'IconHeart',
  'IconSearch',
  'IconMenu',
  'IconTrash',
]

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

  if (config.starter !== 'starter') return

  for (const name of HOME_COMPONENTS) {
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
}
