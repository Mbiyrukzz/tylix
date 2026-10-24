#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { scaffold } from './scaffold.js'

// CLI value -> value scaffold.js uses internally.
const CHOICES = {
  language: {
    js: 'javascript',
    javascript: 'javascript',
    ts: 'typescript',
    typescript: 'typescript',
  },
  database: {
    sqlite: 'sqlite',
    mysql: 'mysql',
    postgres: 'postgres',
    mongodb: 'mongodb',
    none: 'none',
  },
  auth: { yes: true, no: false },
  styling: {
    tailwind: 'tailwind',
    'css-modules': 'css-modules',
    sass: 'sass',
    'plain-css': 'plain-css',
  },
  template: { starter: 'starter', blank: 'blank' },
  'package-manager': { npm: 'npm', pnpm: 'pnpm' },
}

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function parseCli(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        yes: { type: 'boolean', short: 'y' },
        language: { type: 'string' },
        database: { type: 'string' },
        'database-user': { type: 'string' },
        'database-password': { type: 'string' },
        auth: { type: 'string' },
        styling: { type: 'string' },
        template: { type: 'string' },
        'package-manager': { type: 'string' },
        'no-git': { type: 'boolean' },
        'no-install': { type: 'boolean' },
      },
    })
  } catch (err) {
    fail(err.message)
  }

  const { values, positionals } = parsed
  const projectName = positionals[0]

  const resolved = {}
  for (const [flag, map] of Object.entries(CHOICES)) {
    if (values[flag] === undefined) continue
    if (!Object.hasOwn(map, values[flag])) {
      fail(
        `Invalid --${flag} "${values[flag]}". Allowed: ${Object.keys(map).join(', ')}`,
      )
    }
    resolved[flag] = map[values[flag]]
  }

  const nonInteractive = Boolean(values.yes)
  if (nonInteractive && !projectName) fail('--yes requires a project name.')
  if (resolved.auth === true && resolved.database === 'none') {
    fail(
      'Authentication needs a database. Use --database sqlite (or another) or --auth no.',
    )
  }

  // Keys match the config object built in scaffold.js. Anything left
  // undefined is prompted for, or defaulted when --yes is set.
  const options = {
    nonInteractive,
    language: resolved.language,
    database: resolved.database,
    databaseUser: values['database-user'],
    databasePassword: values['database-password'],
    authEnabled: resolved.auth,
    styling: resolved.styling,
    starter: resolved.template,
    packageManager: resolved['package-manager'],
    gitInit: values['no-git'] ? false : undefined,
    installNow: values['no-install'] ? false : undefined,
  }

  return { projectName, options }
}

const { projectName, options } = parseCli(process.argv.slice(2))

scaffold({ projectName, options })
  .then(() => {
    // The prompts leave stdin open, which keeps Node alive after a
    // successful scaffold. Exit explicitly so the command returns.
    process.exit(0)
  })
  .catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
  })