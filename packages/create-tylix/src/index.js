#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Path from this package to the tylix monorepo root, used to build
// file: dependencies while @tylix/* packages aren't published to npm yet.
const MONOREPO_ROOT = path.resolve(__dirname, '../../..')

async function scaffold(projectName) {
  const targetDir = path.join(process.cwd(), projectName)

  const exists = await fs
    .access(targetDir)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    console.error(`Directory "${projectName}" already exists.`)
    process.exit(1)
  }

  console.log(`\nCreating a new Tylix app in ${targetDir}\n`)

  await fs.mkdir(targetDir, { recursive: true })
  await fs.mkdir(path.join(targetDir, 'app', 'models'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'app', 'controllers'), {
    recursive: true,
  })
  await fs.mkdir(path.join(targetDir, 'app', 'Features'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'database', 'migrations'), {
    recursive: true,
  })

  const packageJson = {
    name: projectName,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'tylix dev',
      migrate: 'tylix migrate',
      'css:build':
        'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css',
      'css:watch':
        'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css --watch',
    },
    dependencies: {
      '@tylix/cli': `file:${path.join(MONOREPO_ROOT, 'packages', 'cli')}`,
      '@tylix/auth': `file:${path.join(MONOREPO_ROOT, 'packages', 'auth')}`,
      '@tylix/compiler': `file:${path.join(MONOREPO_ROOT, 'packages', 'compiler')}`,
      '@tylix/core': `file:${path.join(MONOREPO_ROOT, 'packages', 'core')}`,
      '@tylix/generator': `file:${path.join(MONOREPO_ROOT, 'packages', 'generator')}`,
      '@tylix/orm': `file:${path.join(MONOREPO_ROOT, 'packages', 'orm')}`,
      '@tylix/shared': `file:${path.join(MONOREPO_ROOT, 'packages', 'shared')}`,
    },
    devDependencies: {
      tailwindcss: '^3.4.0',
      postcss: '^8.4.0',
      autoprefixer: '^10.4.0',
    },
  }

  await fs.writeFile(
    path.join(targetDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  )

  const configTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'tylix.config.js.template'),
    'utf-8',
  )
  await fs.writeFile(path.join(targetDir, 'tylix.config.js'), configTemplate)

  const tailwindConfigTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'tailwind.config.js.template'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(targetDir, 'tailwind.config.js'),
    tailwindConfigTemplate,
  )

  const postcssConfigTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'postcss.config.js.template'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(targetDir, 'postcss.config.js'),
    postcssConfigTemplate,
  )

  const tailwindInputTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'tailwind-input.css.template'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(targetDir, 'app', 'tailwind-input.css'),
    tailwindInputTemplate,
  )

  const publicDir = path.join(targetDir, 'public')
  await fs.mkdir(publicDir, { recursive: true })
  await fs.copyFile(
    path.join(__dirname, '..', 'assets', 'logo-mark.png'),
    path.join(publicDir, 'logo-mark.png'),
  )
  await fs.copyFile(
    path.join(__dirname, '..', 'assets', 'logo-full.png'),
    path.join(publicDir, 'logo-full.png'),
  )

  // Onboarding pages: Home (with the logo, live code sample, and
  // login/register/guest links) ships as part of every new project,
  // since a first-run experience is core to Tylix's pitch.
  const pagesDir = path.join(targetDir, 'app', 'pages')
  await fs.mkdir(pagesDir, { recursive: true })

  const homePageTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'home-page.tyx.template'),
    'utf-8',
  )
  await fs.writeFile(path.join(pagesDir, 'Home.tyx'), homePageTemplate)

  const registerPageTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'register-page.tyx.template'),
    'utf-8',
  )
  await fs.writeFile(path.join(pagesDir, 'Register.tyx'), registerPageTemplate)

  const loginPageTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'login-page.tyx.template'),
    'utf-8',
  )
  await fs.writeFile(path.join(pagesDir, 'Login.tyx'), loginPageTemplate)

  const dashboardPageTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'dashboard-page.tyx.template'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(pagesDir, 'Dashboard.tyx'),
    dashboardPageTemplate,
  )

  const layoutTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'layout.tyx.template'),
    'utf-8',
  )
  await fs.writeFile(path.join(pagesDir, '_layout.tyx'), layoutTemplate)

  const gitignoreTemplate = await fs.readFile(
    path.join(__dirname, 'templates', 'gitignore.template'),
    'utf-8',
  )
  await fs.writeFile(path.join(targetDir, '.gitignore'), gitignoreTemplate)

  console.log('Installing dependencies (this links local @tylix packages)...\n')
  execSync('npm install', { cwd: targetDir, stdio: 'inherit' })

  // Auth is core to onboarding (Register/Login/Dashboard pages all
  // depend on /api/register, /api/login, /api/me existing), so it's
  // scaffolded and migrated automatically rather than left as a
  // manual step.
  console.log('\nSetting up authentication...\n')
  execSync('npx tylix make:auth', { cwd: targetDir, stdio: 'inherit' })
  execSync('npx tylix migrate', { cwd: targetDir, stdio: 'inherit' })

  console.log(`\n✔ Project created!\n`)
  console.log(`Next steps:\n`)
  console.log(`  cd ${projectName}`)
  console.log(`  npx tylix dev`)
  console.log(
    `\nThen visit http://localhost:3000 -- register an account and you'll`,
  )
  console.log(`land on a working dashboard.\n`)
  console.log(`When you're ready to build something real:`)
  console.log(
    `  npx tylix make:feature Post title:string body:text --dashboard`,
  )
  console.log(`  npx tylix migrate\n`)
}

const projectName = process.argv[2]

if (!projectName) {
  console.error('Usage: create-tylix <project-name>')
  process.exit(1)
}

scaffold(projectName).catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
