import {
  printLogo,
  printDivider,
  printHeavyDivider,
  printSection,
  bold,
  dim,
  cyan,
  cyanBright,
  green,
  yellow,
  red,
} from '@tylix/shared'

import { detectDatabaseUsers } from './utils/detectDatabaseUsers.js'
import { createProgressBar } from './utils/progress.js'
import { select, confirm, text, password } from './utils/prompt.js'
import { createProjectStructure } from './steps/createProjectStructure.js'
import { installPackages } from './steps/installPackages.js'
import { writeStylingConfig } from './steps/writeStylingConfig.js'
import { writeCompilerConfig } from './steps/writeCompilerConfig.js'
import { writeOrmConfig } from './steps/writeOrmConfig.js'
import { writeDatabaseConfig } from './steps/writeDatabaseConfig.js'
import { generateAuth } from './steps/generateAuth.js'
import { generatePostBoilerplate } from './steps/generatePostBoilerplate.js'
import { writePage, writeLayout } from './steps/writePage.js'
import { writeMiddleware } from './steps/writeMiddleware.js'
import { writeComponents } from './steps/writeComponents.js'
import { writeApiRoutes } from './steps/writeApiRoutes.js'
import { writeMailConfig } from './steps/writeMailConfig.js'
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

  let databaseUser = ''
  let databasePassword = ''
  if (database === 'postgres' || database === 'mysql') {
    const defaultUser = database === 'postgres' ? 'postgres' : 'root'
    const detectedUsers = detectDatabaseUsers(database)

    const choices = detectedUsers
      ? detectedUsers.map((name) => ({
          label: name,
          value: name,
          hint: name === defaultUser ? 'Default admin user' : undefined,
        }))
      : [
          {
            label: defaultUser,
            value: defaultUser,
            hint: 'Common default — not verified',
          },
        ]

    choices.push({ label: 'Custom…', value: '__custom__' })

    const userChoice = await select({
      message: detectedUsers
        ? 'Database User (detected from your local server)'
        : 'Database User',
      choices,
    })
    printDivider(110)

    if (userChoice === '__custom__') {
      databaseUser = await text({
        message: 'Enter database username',
        initial: defaultUser,
      })
      printDivider(110)
    } else {
      databaseUser = userChoice
    }

    databasePassword = await password({
      message: `Enter the password for the "${databaseUser}" user`,
    })
    printDivider(110)
  }

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

  console.log(bold('Configuration'))
  console.log(`Project Name      ${cyanBright(projectName)}`)
  console.log(
    `Language          ${cyanBright(language === 'javascript' ? 'JavaScript' : 'TypeScript')}`,
  )
  console.log(`Database          ${cyanBright(database)}`)
  if (databaseUser) {
    console.log(`Database User     ${cyanBright(databaseUser)}`)
  }
  console.log(
    `Authentication    ${authEnabled ? green('Enabled') : dim('Disabled')}`,
  )
  console.log(`Styling           ${cyanBright(styling)}`)
  console.log(
    `Starter           ${cyanBright(starter === 'starter' ? 'Starter App' : 'Blank')}`,
  )
  console.log(`Package Manager   ${cyanBright(packageManager)}`)
  console.log(`Git               ${gitInit ? green('Yes') : dim('No')}`)
  printDivider(54)

  await select({
    message: '',
    choices: [{ label: 'Create Project', value: true }],
  })

  return {
    projectName,
    language,
    database,
    databaseUser,
    databasePassword,
    authEnabled,
    styling,
    starter,
    packageManager,
    gitInit,
    installNow,
  }
}

async function runBuildSteps(config) {
  console.log(`\n${bold('Creating your Tylix application...')}\n`)

  const steps = [
    {
      label: 'Creating project structure',
      fn: () => createProjectStructure(config),
    },
  ]
  if (config.installNow) {
    steps.push({
      label: 'Installing packages',
      fn: () => installPackages(config),
    })
  }
  steps.push(
    { label: 'Configuring compiler', fn: () => writeCompilerConfig(config) },
    { label: 'Configuring ORM', fn: () => writeOrmConfig(config) },
    { label: 'Configuring database', fn: () => writeDatabaseConfig(config) },
    { label: 'Configuring mail', fn: () => writeMailConfig(config) },
    { label: 'Configuring styling', fn: () => writeStylingConfig(config) },
  )
  if (config.authEnabled) {
    steps.push({
      label: 'Generating authentication',
      fn: () => generateAuth(config),
    })
  }
  steps.push(
    { label: 'Creating dashboard', fn: () => writePage(config, 'Dashboard') },
    {
      label: 'Creating Mail page',
      fn: () => writePage(config, 'dashboard/Mail'),
    },
    { label: 'Creating Home page', fn: () => writePage(config, 'Home') },
  )
  if (config.authEnabled) {
    steps.push(
      { label: 'Creating Login page', fn: () => writePage(config, 'Login') },
      {
        label: 'Creating Register page',
        fn: () => writePage(config, 'Register'),
      },
    )
  }
  steps.push(
    { label: 'Creating middleware', fn: () => writeMiddleware(config) },
    { label: 'Creating layouts', fn: () => writeLayout(config) },
    { label: 'Creating components', fn: () => writeComponents(config) },
    { label: 'Creating API routes', fn: () => writeApiRoutes(config) },
  )
  if (config.starter === 'starter' && config.authEnabled) {
    steps.push({
      label: 'Creating Post feature',
      fn: () => generatePostBoilerplate(config),
    })
  }
  // Marked optional: a bad password or an unreachable database server
  // shouldn't abort the whole scaffold. The project is still fully
  // usable without migrations having run -- the dev can fix their
  // .env and run `tylix migrate` by hand afterwards.
  steps.push({
    label: 'Creating migrations',
    fn: () => runMigrations(config),
    optional: true,
    warningMessage:
      "Couldn't connect to the database to run migrations — that's okay, you can always configure it later in your .env file and run `tylix migrate` yourself.",
  })
  if (config.gitInit) {
    steps.push({
      label: 'Initializing Git repository',
      fn: () => initGit(config),
    })
  }
  steps.push({ label: 'Finalizing project', fn: () => finalize(config) })

  const warnings = []
  const progress = createProgressBar(steps.length)
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    progress.render(step.label, i)
    try {
      await step.fn()
    } catch (err) {
      if (!step.optional) throw err
      warnings.push(
        step.warningMessage ?? `Skipped "${step.label}": ${err.message}`,
      )
    }
  }
  progress.render('Done', steps.length)
  console.log()

  for (const message of warnings) {
    console.log(yellow(`⚠ ${message}`))
  }
  if (warnings.length) console.log()
}

function printSuccessScreen(config) {
  printHeavyDivider()
  console.log(bold(green('🎉  Success!')))
  console.log('Your application has been created.\n')

  console.log(bold('Project'))
  console.log(`📁 ${cyanBright(config.projectName)}\n`)

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

  console.log(bold('Database'))
  console.log(`${green('✓')} ${config.database}\n`)

  console.log(bold('API'))
  console.log('POST   /api/register')
  console.log('POST   /api/login')
  console.log('POST   /api/auth/refresh')
  console.log('POST   /api/auth/logout')
  console.log('GET    /api/auth/verify-email')
  console.log('POST   /api/auth/forgot-password')
  console.log('POST   /api/auth/reset-password')
  console.log('GET    /api/me')
  if (config.starter === 'starter' && config.authEnabled) {
    console.log('GET    /api/posts')
    console.log('POST   /api/posts')
    console.log('GET    /api/posts/:id')
    console.log('DELETE /api/posts/:id')
  }
  console.log('GET    /dashboard')
  printHeavyDivider()

  console.log(bold('Next Steps'))
  console.log(cyanBright(`cd ${config.projectName}`))
  console.log(cyanBright(`${config.packageManager} run dev`))
  printHeavyDivider()

  console.log(bold('Development Server'))
  console.log(cyanBright('http://localhost:3000\n'))
  console.log(bold('Documentation'))
  console.log(cyanBright('https://tylix.dev/docs\n'))
  console.log(bold('Discord'))
  console.log(cyanBright('https://discord.gg/tylix\n'))
  console.log(bold('GitHub'))
  console.log(cyanBright('https://github.com/tylixjs'))
  printHeavyDivider()

  console.log(bold(green('Happy building with Tylix ')))
}

export async function scaffold({ projectName: initialProjectName } = {}) {
  const config = await runWizard(initialProjectName)
  await runBuildSteps(config)
  printSuccessScreen(config)
}
