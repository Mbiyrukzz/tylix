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

export async function writeComponents(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const componentsDir = path.join(targetDir, 'app', 'pages', 'components') // was: 'app', 'components' — dev.js's loadComponents() never looks there
  await fs.mkdir(componentsDir, { recursive: true })

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
