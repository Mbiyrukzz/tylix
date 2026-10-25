import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const MONOREPO_PACKAGES_DIR = path.join(MONOREPO_ROOT, 'packages')

const CREATE_RESOURCE_JS_SOURCE = `export function createResource({ list, create, update, remove }) {
  return reactive({
    data: [],
    loading: false,
    error: null,
    async load(...args) {
      this.loading = true
      this.error = null
      const result = await list(...args)
      if (result.ok) {
        this.data = result.data
      } else {
        this.error = result.error ?? 'Failed to load'
      }
      this.loading = false
      return result
    },
    async create(payload) {
      const result = await create(payload)
      if (result.ok) this.data = [result.data, ...this.data]
      return result
    },
    async update(id, payload) {
      const result = await update(id, payload)
      if (result.ok) {
        this.data = this.data.map((item) => (item.id === id ? result.data : item))
      }
      return result
    },
    async remove(id) {
      const result = await remove(id)
      if (result.ok) this.data = this.data.filter((item) => item.id !== id)
      return result
    },
  })
}
`

const CREATE_RESOURCE_TS_SOURCE = `interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

interface ResourceConfig<T> {
  list: (...args: unknown[]) => Promise<unknown>
  create: (payload: unknown) => Promise<unknown>
  update: (id: number | string, payload: unknown) => Promise<unknown>
  remove: (id: number | string) => Promise<unknown>
}

export function createResource<T extends { id: number | string }>({ list, create, update, remove }: ResourceConfig<T>) {
  return reactive({
    data: [] as T[],
    loading: false,
    error: null as string | null,
    async load(...args: unknown[]) {
      this.loading = true
      this.error = null
      const result = (await list(...args)) as ApiResult<T[]>
      if (result.ok && result.data) {
        this.data = result.data
      } else {
        this.error = result.error ?? 'Failed to load'
      }
      this.loading = false
      return result
    },
    async create(payload: unknown) {
      const result = (await create(payload)) as ApiResult<T>
      if (result.ok && result.data) this.data = [result.data, ...this.data]
      return result
    },
    async update(id: number | string, payload: unknown) {
      const result = (await update(id, payload)) as ApiResult<T>
      if (result.ok && result.data) {
        this.data = this.data.map((item) => (item.id === id ? result.data! : item))
      }
      return result
    },
    async remove(id: number | string) {
      const result = (await remove(id)) as ApiResult<null>
      if (result.ok) this.data = this.data.filter((item) => item.id !== id)
      return result
    },
  })
}
`

// Published version pins, used whenever we're NOT running from inside
// the monorepo (e.g. someone ran `npx create-tylix` after installing
// it from the registry). Bump these as real versions get published.
const PUBLISHED_VERSIONS = {
  '@tylix/cli': '^0.5.1',
  '@tylix/core': '^0.5.1',
  '@tylix/compiler': '^0.5.1',
  '@tylix/generator': '^0.5.1',
  '@tylix/orm': '^0.5.1',
  '@tylix/shared': '^0.5.1',
  '@tylix/auth': '^0.5.1',
  '@tylix/mail': '^0.5.1',
  'tylix-icons': '^0.5.1',
}

// Package name -> folder under packages/. Used for file: links and for
// `overrides`, so transitive @tylix/* dependencies (e.g. the CLI's own
// dependency on core) also resolve to the local checkout instead of
// the registry.
const LOCAL_PACKAGE_DIRS = {
  '@tylix/cli': 'cli',
  '@tylix/core': 'core',
  '@tylix/compiler': 'compiler',
  '@tylix/generator': 'generator',
  '@tylix/orm': 'orm',
  '@tylix/shared': 'shared',
  '@tylix/mail': 'mail',
  '@tylix/auth': 'auth',
  'tylix-icons': 'tylix-icons',
}

// Packages every generated app depends on directly. @tylix/auth is
// added separately, only when authentication is enabled.
const BASE_DEPENDENCIES = [
  '@tylix/cli',
  '@tylix/core',
  '@tylix/compiler',
  '@tylix/generator',
  '@tylix/orm',
  '@tylix/shared',
  '@tylix/mail',
  'tylix-icons',
]

// Shared by .env and .env.example. Off by default: with it on, the server
// believes the X-Forwarded-For header, which any client can fake unless a
// proxy you control sits in front of the app.
const TRUST_PROXY_ENV_LINES = [
  `# Set to true only when this app runs behind a reverse proxy you control`,
  `# (nginx, Caddy, a load balancer). Leave false otherwise, because clients`,
  `# could fake their IP address through the X-Forwarded-For header.`,
  `TRUST_PROXY=false`,
]


function buildDebugEnvLines(value) {
  return [
    `# Shows real error details (SQL, stack traces, request data) in the browser`,
    `# and API responses. Keep false in production: it leaks internals.`,
    `APP_DEBUG=${value}`,
  ]
}

function buildMailEnvLines(config) {
  return [
    `MAIL_DRIVER=log`,
    `MAIL_FROM=noreply@${config.projectName}.test`,
    `MAIL_HOST=`,
    `MAIL_PORT=`,
    `MAIL_SECURE=false`,
    `MAIL_USER=`,
    `MAIL_PASSWORD=`,
  ]
}

// YYYYMMDDHHMMSS, the same scheme the auth and feature migrations use.
// The offset (in seconds) keeps migrations created in one run distinct
// and in a stable order.
function migrationTimestamp(baseMs, offsetSeconds = 0) {
  return new Date(baseMs + offsetSeconds * 1000)
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
}

function buildDatabaseEnvLines(config) {
  const projectSlug = config.projectName
  const driver = config.database
  const dbPassword = config.databasePassword ?? ''

  switch (driver) {
    case 'sqlite':
      return [`DATABASE_DRIVER=sqlite`, `DATABASE_FILENAME=database.sqlite`]
    case 'postgres':
      return [
        `DATABASE_DRIVER=postgres`,
        `DATABASE_HOST=127.0.0.1`,
        `DATABASE_PORT=5432`,
        `DATABASE_USER=${config.databaseUser || 'postgres'}`,
        `DATABASE_PASSWORD=${dbPassword}`,
        `DATABASE_NAME=${projectSlug}`,
      ]
    case 'mysql':
      return [
        `DATABASE_DRIVER=mysql`,
        `DATABASE_HOST=127.0.0.1`,
        `DATABASE_PORT=3306`,
        `DATABASE_USER=${config.databaseUser || 'root'}`,
        `DATABASE_PASSWORD=${dbPassword}`,
        `DATABASE_NAME=${projectSlug}`,
      ]

    case 'mongodb':
      return [
        `DATABASE_DRIVER=mongodb`,
        `DATABASE_URL=mongodb://localhost:27017`,
        `DATABASE_NAME=${projectSlug}`,
      ]
    case 'none':
      return [`DATABASE_DRIVER=none`]
    default:
      throw new Error(`Unknown database choice "${driver}"`)
  }
}

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

export async function createProjectStructure(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const isTs = config.language === 'typescript'
  const ext = isTs ? 'ts' : 'js'

  const exists = await pathExists(targetDir)
  if (exists) {
    throw new Error(`Directory "${config.projectName}" already exists.`)
  }

  await fs.mkdir(targetDir, { recursive: true })

  try {
    if (isTs) {
      const tsconfigTemplate = await fs.readFile(
        path.join(PACKAGE_ROOT, 'src', 'templates', 'tsconfig.json.template'),
        'utf-8',
      )
      await fs.writeFile(
        path.join(targetDir, 'tsconfig.json'),
        tsconfigTemplate,
      )

      // Ambient declaration for the framework-injected `useApi` global.
      // Without this, every generated .ts file that calls useApi() fails
      // with "Cannot find name 'useApi'" (TS2304).
      await fs.mkdir(path.join(targetDir, 'app', 'types'), { recursive: true })
            await fs.writeFile(
        path.join(targetDir, 'app', 'types', 'globals.d.ts'),
        `declare function useApi<T = unknown>(\n  url: string,\n  options?: { method?: string; body?: unknown }\n): Promise<T>\n\ndeclare function reactive<T extends object>(state: T): T\n\ndeclare function notFound(): void\n`,
      )
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

    await fs.mkdir(path.join(targetDir, 'app', 'routes'), { recursive: true })
    await fs.writeFile(
      path.join(targetDir, 'app', 'routes', `web.${ext}`),
      isTs
        ? `import type { Router } from '@tylix/core'\n\nexport async function routes(router: Router) {\n  // router.use(someMiddleware)\n  // router.get('/health', (req, res) => res.json({ ok: true }))\n}\n`
        : `export async function routes(router) {\n  // router.use(someMiddleware)\n  // router.get('/health', (req, res) => res.json({ ok: true }))\n}\n`,
    )

    await fs.mkdir(path.join(targetDir, 'app', 'useApi'), { recursive: true })
    await fs.writeFile(
      path.join(targetDir, 'app', 'useApi', `getApi.${ext}`),
      isTs
        ? `export const getApi = (table: string) => useApi(\`/api/\${table}\`)\n`
        : `export const getApi = (table) => useApi(\`/api/\${table}\`)\n`,
    )
    await fs.writeFile(
      path.join(targetDir, 'app', 'useApi', `postApi.${ext}`),
      isTs
        ? `export const postApi = (table: string, data: unknown) =>\n  useApi(\`/api/\${table}\`, { method: 'POST', body: data })\n`
        : `export const postApi = (table, data) => useApi(\`/api/\${table}\`, { method: 'POST', body: data })\n`,
    )
    await fs.writeFile(
      path.join(targetDir, 'app', 'useApi', `putApi.${ext}`),
      isTs
        ? `export const putApi = (table: string, id: number | string, data: unknown) =>\n  useApi(\`/api/\${table}/\${id}\`, { method: 'PUT', body: data })\n`
        : `export const putApi = (table, id, data) => useApi(\`/api/\${table}/\${id}\`, { method: 'PUT', body: data })\n`,
    )
    await fs.writeFile(
      path.join(targetDir, 'app', 'useApi', `deleteApi.${ext}`),
      isTs
        ? `export const deleteApi = (table: string, id: number | string) =>\n  useApi(\`/api/\${table}/\${id}\`, { method: 'DELETE' })\n`
        : `export const deleteApi = (table, id) => useApi(\`/api/\${table}/\${id}\`, { method: 'DELETE' })\n`,
    )

    await fs.writeFile(
      path.join(targetDir, 'app', 'useApi', `createResource.${ext}`),
      isTs ? CREATE_RESOURCE_TS_SOURCE : CREATE_RESOURCE_JS_SOURCE,
    )
    const dbEnvLines = buildDatabaseEnvLines(config)

       await fs.writeFile(
      path.join(targetDir, '.env'),
      [
        `PORT=3000`,
        `AUTH_SECRET=${crypto.randomBytes(32).toString('hex')}`,
        ``,
        ...buildDebugEnvLines('true'),
        ``,
        ...dbEnvLines,
        ``,
        ...buildMailEnvLines(config),
        ``,
        ...TRUST_PROXY_ENV_LINES,
        ``,
        `# Set to true only if you're developing @tylix/compiler itself`,
        `TYLIX_HOT_RELOAD_COMPILER=false`,
      ].join('\n') + '\n',
    )
    await fs.writeFile(
      path.join(targetDir, '.env.example'),
      [
        `PORT=3000`,
        `AUTH_SECRET=`,
        ``,
        ...buildDebugEnvLines('false'),
        ``,
        ...dbEnvLines.map((line) =>
          line.startsWith('DATABASE_PASSWORD=') ? 'DATABASE_PASSWORD=' : line,
        ),
        ``,
        ...buildMailEnvLines(config),
        ``,
        ...TRUST_PROXY_ENV_LINES,
        ``,
        `# Set to true only if you're developing @tylix/compiler itself`,
        `TYLIX_HOT_RELOAD_COMPILER=false`,
      ].join('\n') + '\n',
    )

    await fs.writeFile(
      path.join(targetDir, 'app', `schedule.${ext}`),
      isTs
        ? `import type { Scheduler } from '@tylix/core'\n\nexport async function schedule(scheduler: Scheduler) {\n  // scheduler.daily('03:00', async () => { /* cleanup */ })\n  // scheduler.every('5m', async () => { /* poll */ })\n}\n`
        : `export async function schedule(scheduler) {\n  // scheduler.daily('03:00', async () => { /* cleanup */ })\n  // scheduler.every('5m', async () => { /* poll */ })\n}\n`,
    )

    // One base time for every migration written in this run.
    const migrationBase = Date.now()

    await fs.writeFile(
      path.join(
        targetDir,
        'database',
        'migrations',
        `${migrationTimestamp(migrationBase, 0)}_create_jobs_table.${ext}`,
      ),
      isTs
        ? `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: Job\n *\n * Do not edit this section.\n */\n\nimport type { Schema, CreateTableBuilder } from '@tylix/shared'\n\nexport const up = async (schema: Schema) => {\n    await schema.createTable("jobs", (table: CreateTableBuilder) => {\n        table.increments("id");\n        table.string("job");\n        table.text("payload");\n        table.string("status");\n        table.integer("attempts");\n        table.text("error");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema: Schema) => {\n    await schema.dropTable("jobs");\n};\n`
        : `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: Job\n *\n * Do not edit this section.\n */\n\nexport const up = async (schema) => {\n    await schema.createTable("jobs", (table) => {\n        table.increments("id");\n        table.string("job");\n        table.text("payload");\n        table.string("status");\n        table.integer("attempts");\n        table.text("error");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema) => {\n    await schema.dropTable("jobs");\n};\n`,
    )

    await fs.writeFile(
      path.join(
        targetDir,
        'database',
        'migrations',
        `${migrationTimestamp(migrationBase, 1)}_create_cache_table.${ext}`,
      ),
      isTs
        ? `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: Cache\n *\n * Do not edit this section.\n */\n\nimport type { Schema, CreateTableBuilder } from '@tylix/shared'\n\nexport const up = async (schema: Schema) => {\n    await schema.createTable("cache", (table: CreateTableBuilder) => {\n        table.increments("id");\n        table.string("key").unique();\n        table.text("value");\n        table.datetime("expires_at");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema: Schema) => {\n    await schema.dropTable("cache");\n};\n`
        : `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: Cache\n *\n * Do not edit this section.\n */\n\nexport const up = async (schema) => {\n    await schema.createTable("cache", (table) => {\n        table.increments("id");\n        table.string("key").unique();\n        table.text("value");\n        table.datetime("expires_at");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema) => {\n    await schema.dropTable("cache");\n};\n`,
    )

    await fs.writeFile(
      path.join(
        targetDir,
        'database',
        'migrations',
        `${migrationTimestamp(migrationBase, 2)}_create_mail_logs_table.${ext}`,
      ),
      isTs
        ? `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: MailLog\n *\n * Do not edit this section.\n */\n\nimport type { Schema, CreateTableBuilder } from '@tylix/shared'\n\nexport const up = async (schema: Schema) => {\n    await schema.createTable("mail_logs", (table: CreateTableBuilder) => {\n        table.increments("id");\n        table.string("recipient");\n        table.string("subject");\n        table.text("body");\n        table.string("driver");\n        table.string("status");\n        table.text("error");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema: Schema) => {\n    await schema.dropTable("mail_logs");\n};\n`
        : `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: MailLog\n *\n * Do not edit this section.\n */\n\nexport const up = async (schema) => {\n    await schema.createTable("mail_logs", (table) => {\n        table.increments("id");\n        table.string("recipient");\n        table.string("subject");\n        table.text("body");\n        table.string("driver");\n        table.string("status");\n        table.text("error");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema) => {\n    await schema.dropTable("mail_logs");\n};\n`,
    )

    await fs.mkdir(path.join(targetDir, 'app', 'jobs'), { recursive: true })
    await fs.writeFile(
      path.join(targetDir, 'app', 'jobs', `SendWelcomeEmail.${ext}`),
      isTs
        ? `export const SendWelcomeEmail = {\n  async handle(payload: { userId: string | number; [key: string]: unknown }) {\n    // payload.userId, etc.\n  },\n}\n`
        : `export const SendWelcomeEmail = {\n  async handle(payload) {\n    // payload.userId, etc.\n  },\n}\n`,
    )

    await fs.mkdir(path.join(targetDir, 'app', 'mail'), { recursive: true })

    await fs.mkdir(path.join(targetDir, 'app', 'capabilities'), {
      recursive: true,
    })

    await fs.mkdir(path.join(targetDir, 'app', 'seeders'), { recursive: true })

    await fs.writeFile(
      path.join(targetDir, 'app', 'seeders', `DatabaseSeeder.${ext}`),
      `export async function seed() {\n  // e.g.:\n  // await Post.create({ title: 'First post', body: '...' })\n}\n`,
    )

    // Use file: links only when THIS create-tylix is the copy inside the
    // monorepo checkout (or TYLIX_LOCAL=1 forces it). A bare "a packages/
    // dir exists" check could misfire if someone runs `npx create-tylix`
    // from inside an unrelated monorepo; comparing our own location
    // cannot. Everyone who installed from the registry gets real
    // published versions instead of broken local paths.
    const isDevMonorepoContext =
      process.env.TYLIX_LOCAL === '1' ||
      PACKAGE_ROOT === path.join(MONOREPO_PACKAGES_DIR, 'create-tylix')

    const filePkg = (name) =>
      `file:${path.join(MONOREPO_PACKAGES_DIR, LOCAL_PACKAGE_DIRS[name])}`
    const pkgSpec = (name) =>
      isDevMonorepoContext ? filePkg(name) : PUBLISHED_VERSIONS[name]

    const dependencies = {}
    for (const name of BASE_DEPENDENCIES) {
      dependencies[name] = pkgSpec(name)
    }
    if (config.authEnabled) {
      dependencies['@tylix/auth'] = pkgSpec('@tylix/auth')
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
    if (isTs) {
      Object.assign(devDependencies, {
        typescript: '^5.5.0',
        tsx: '^4.16.0',
        '@types/node': '^22.0.0',
      })
    }

    // `build` and `start` are always present. `build` is the
    // pre-flight gate (config check, typecheck, minified CSS) and
    // `start` is the production server. Neither needs to be run by
    // hand for `dev`.
    const scripts = {
      dev: 'tylix dev',
      build: 'tylix build',
      start: 'tylix start',
      migrate: 'tylix migrate',
    }
    if (config.styling === 'tailwind') {
      scripts['css:build'] =
        'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css'
      scripts['css:watch'] =
        'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css --watch'
    }
    if (isTs) {
      scripts.typecheck = 'tsc --noEmit'
    }

    const packageJson = {
      name: config.projectName,
      version: '0.1.0',
      type: 'module',
      scripts,
      dependencies,
      devDependencies,
    }

    // Local testing only: force every @tylix/* package, including the
    // ones pulled in transitively (the CLI depends on core, core on
    // auth, and so on), to resolve to the local checkout. Without this
    // npm mixes local copies with registry copies. The override specs
    // are identical to the direct dependency specs above, which npm
    // requires, otherwise it throws EOVERRIDE.
    if (isDevMonorepoContext) {
      packageJson.overrides = Object.fromEntries(
        Object.keys(LOCAL_PACKAGE_DIRS).map((name) => [name, filePkg(name)]),
      )
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

        // Favicon: browsers request /favicon.ico on their own even without a
    // <link> tag, so ship both names. Both are copies of the logo mark.
    await fs.copyFile(
      path.join(PACKAGE_ROOT, 'assets', 'logo-mark.png'),
      path.join(targetDir, 'public', 'favicon.png'),
    )
    await fs.copyFile(
      path.join(PACKAGE_ROOT, 'assets', 'logo-mark.png'),
      path.join(targetDir, 'public', 'favicon.ico'),
    )

    return targetDir
  } catch (err) {
    // Partial scaffold on disk is worse than no scaffold -- clean up
    // before letting the error bubble, so a retry starts from zero
    // instead of hitting "Directory already exists" on the next run.
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}