import {
  printLogo,
  printDivider,
  printHeavyDivider,
  printSection,
} from './utils/banner.js'
import { select, confirm, text } from './utils/prompt.js'
import { createProjectStructure } from './steps/createProjectStructure.js'
import { installPackages } from './steps/installPackages.js'
import { writeStylingConfig } from './steps/writeStylingConfig.js'
import { writeCompilerConfig } from './steps/writeCompilerConfig.js'
import { writeOrmConfig } from './steps/writeOrmConfig.js'
import { writeDatabaseConfig } from './steps/writeDatabaseConfig.js'
import { generateAuth } from './steps/generateAuth.js'
import { writePage, writeLayout } from './steps/writePage.js'
import { writeMiddleware } from './steps/writeMiddleware.js'
import { writeComponents } from './steps/writeComponents.js'
import { writeApiRoutes } from './steps/writeApiRoutes.js'
import { runMigrations } from './steps/runMigrations.js'
import { initGit } from './steps/initGit.js'
import { finalize } from './steps/finalize.js'

async function runWizard(initialProjectName) {
  printLogo()
  printDivider()

  const projectName = await text({
    message: 'Project Name',
    initial: initialProjectName || 'my-awesome-app',
  })
  printDivider(110)

  const language = await select({
    message: 'Choose your language',
    choices: [
      { label: 'JavaScript', value: 'javascript', hint: '(Recommended)' },
      { label: 'TypeScript', value: 'typescript' },
    ],
  })
  printDivider(110)

  const database = await select({
    message: 'Choose your database',
    choices: [
      { label: 'SQLite', value: 'sqlite', hint: 'Great for development' },
      { label: 'MySQL', value: 'mysql', hint: 'Production ready' },
      { label: 'PostgreSQL', value: 'postgres', hint: 'Advanced SQL' },
      { label: 'MongoDB', value: 'mongodb', hint: 'Document database' },
      { label: 'None', value: 'none', hint: "I'll configure later" },
    ],
  })
  printDivider(110)

  const authEnabled = await confirm({ message: 'Authentication' })
  printDivider(110)

  const styling = await select({
    message: 'Styling',
    choices: [
      { label: 'Tailwind CSS', value: 'tailwind' },
      { label: 'CSS Modules', value: 'css-modules' },
      { label: 'Sass', value: 'sass' },
      { label: 'Plain CSS', value: 'plain-css' },
    ],
  })
  printDivider(110)

  const starter = await select({
    message: 'Starter Template',
    choices: [
      { label: 'Starter App', value: 'starter' },
      { label: 'Blank', value: 'blank' },
    ],
  })
  printDivider(110)

  const packageManager = await select({
    message: 'Package Manager',
    choices: [
      { label: 'npm', value: 'npm' },
      { label: 'pnpm', value: 'pnpm' },
    ],
  })
  printDivider(110)

  const gitInit = await confirm({ message: 'Initialize Git?' })
  printDivider(110)

  const installNow = await confirm({ message: 'Install dependencies now?' })
  printDivider(110)

  console.log('Configuration')
  console.log(`Project Name      ${projectName}`)
  console.log(
    `Language          ${language === 'javascript' ? 'JavaScript' : 'TypeScript'}`,
  )
  console.log(`Database          ${database}`)
  console.log(`Authentication    ${authEnabled ? 'Enabled' : 'Disabled'}`)
  console.log(`Styling           ${styling}`)
  console.log(
    `Starter           ${starter === 'starter' ? 'Starter App' : 'Blank'}`,
  )
  console.log(`Package Manager   ${packageManager}`)
  console.log(`Git               ${gitInit ? 'Yes' : 'No'}`)
  printDivider(54)

  await select({
    message: '',
    choices: [{ label: 'Create Project', value: true }],
  })

  return {
    projectName,
    language,
    database,
    authEnabled,
    styling,
    starter,
    packageManager,
    gitInit,
    installNow,
  }
}

async function runBuildSteps(config) {
  console.log('\nCreating your Tylix application...\n')

  async function step(label, fn) {
    await fn()
    console.log(`✔ ${label}`)
  }

  await step('Creating project structure', () => createProjectStructure(config))
  if (config.installNow) {
    await step('Installing packages', () => installPackages(config))
  }
  await step('Configuring compiler', () => writeCompilerConfig(config))
  await step('Configuring ORM', () => writeOrmConfig(config))
  await step('Configuring database', () => writeDatabaseConfig(config))
  await step('Configuring styling', () => writeStylingConfig(config))
  if (config.authEnabled) {
    await step('Generating authentication', () => generateAuth(config))
  }
  await step('Creating dashboard', () => writePage(config, 'Dashboard'))
  await step('Creating Home page', () => writePage(config, 'Home'))
  if (config.authEnabled) {
    await step('Creating Login page', () => writePage(config, 'Login'))
    await step('Creating Register page', () => writePage(config, 'Register'))
  }
  await step('Creating middleware', () => writeMiddleware(config))
  await step('Creating layouts', () => writeLayout(config))
  await step('Creating components', () => writeComponents(config))
  await step('Creating API routes', () => writeApiRoutes(config))
  await step('Creating migrations', () => runMigrations(config))
  if (config.gitInit) {
    await step('Initializing Git repository', () => initGit(config))
  }
  await step('Finalizing project', () => finalize(config))
}

function printSuccessScreen(config) {
  printHeavyDivider()
  console.log('🎉  Success!')
  console.log('Your application has been created.\n')

  console.log('Project')
  console.log(`📁 ${config.projectName}\n`)

  printSection(
    'Pages',
    config.starter === 'starter'
      ? ['Home', 'Login', 'Register', 'Dashboard']
      : ['Home'],
  )
  console.log()

  if (config.authEnabled) {
    printSection('Authentication', [
      'Login',
      'Register',
      'Password Reset',
      'Email Verification',
    ])
    console.log()
  }

  console.log('Database')
  console.log(`✓ ${config.database}\n`)

  console.log('API')
  console.log('POST   /api/register')
  console.log('POST   /api/login')
  console.log('GET    /api/me')
  console.log('GET    /dashboard')
  printHeavyDivider()

  console.log('Next Steps')
  console.log(`cd ${config.projectName}`)
  console.log(`${config.packageManager} run dev`)
  printHeavyDivider()

  console.log('Development Server')
  console.log('http://localhost:3000\n')
  console.log('Documentation')
  console.log('https://tylix.dev/docs\n')
  console.log('Discord')
  console.log('https://discord.gg/tylix\n')
  console.log('GitHub')
  console.log('https://github.com/tylixjs')
  printHeavyDivider()

  console.log('Happy building with Tylix 🚀')
}

export async function scaffold({ projectName: initialProjectName } = {}) {
  const config = await runWizard(initialProjectName)
  await runBuildSteps(config)
  printSuccessScreen(config)
}
