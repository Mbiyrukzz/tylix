import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')

export async function createProjectStructure(config) {
  const targetDir = path.join(process.cwd(), config.projectName)

  const exists = await fs
    .access(targetDir)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    throw new Error(`Directory "${config.projectName}" already exists.`)
  }

  await fs.mkdir(path.join(targetDir, 'app', 'models'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'app', 'controllers'), {
    recursive: true,
  })
  await fs.mkdir(path.join(targetDir, 'app', 'Features'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'app', 'pages'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'database', 'migrations'), {
    recursive: true,
  })
  await fs.mkdir(path.join(targetDir, 'public'), { recursive: true })

  const dependencies = {
    '@tylix/cli': `file:${path.join(MONOREPO_ROOT, 'packages', 'cli')}`,
    '@tylix/core': `file:${path.join(MONOREPO_ROOT, 'packages', 'core')}`,
    '@tylix/compiler': `file:${path.join(MONOREPO_ROOT, 'packages', 'compiler')}`,
    '@tylix/generator': `file:${path.join(MONOREPO_ROOT, 'packages', 'generator')}`,
    '@tylix/orm': `file:${path.join(MONOREPO_ROOT, 'packages', 'orm')}`,
    '@tylix/shared': `file:${path.join(MONOREPO_ROOT, 'packages', 'shared')}`,
  }
  if (config.authEnabled) {
    dependencies['@tylix/auth'] =
      `file:${path.join(MONOREPO_ROOT, 'packages', 'auth')}`
  }

  const devDependencies = {}
  if (config.styling === 'tailwind') {
    Object.assign(devDependencies, {
      tailwindcss: '^3.4.0',
      postcss: '^8.4.0',
      autoprefixer: '^10.4.0',
    })
  } else if (config.styling === 'sass') {
    devDependencies.sass = '^1.77.0'
  }
  // css-modules / plain-css need no extra devDependencies

  const scripts = {
    dev: 'tylix dev',
    migrate: 'tylix migrate',
  }
  if (config.styling === 'tailwind') {
    scripts['css:build'] =
      'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css'
    scripts['css:watch'] =
      'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css --watch'
  }

  const packageJson = {
    name: config.projectName,
    version: '0.1.0',
    type: 'module',
    scripts,
    dependencies,
    devDependencies,
  }

  await fs.writeFile(
    path.join(targetDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  )

  const gitignoreTemplate = await fs.readFile(
    path.join(PACKAGE_ROOT, 'src', 'templates', 'gitignore.template'),
    'utf-8',
  )
  await fs.writeFile(path.join(targetDir, '.gitignore'), gitignoreTemplate)

  await fs.copyFile(
    path.join(PACKAGE_ROOT, 'assets', 'logo-mark.png'),
    path.join(targetDir, 'public', 'logo-mark.png'),
  )
  await fs.copyFile(
    path.join(PACKAGE_ROOT, 'assets', 'logo-full.png'),
    path.join(targetDir, 'public', 'logo-full.png'),
  )

  return targetDir
}
