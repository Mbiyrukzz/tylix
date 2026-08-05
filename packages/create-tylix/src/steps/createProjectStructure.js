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
// Published version pins, used whenever we're NOT running from inside
// the monorepo (e.g. someone ran `npx create-tylix` after installing
// it from the registry). Bump these as real versions get published.
const PUBLISHED_VERSIONS = {
  '@tylix/cli': '^0.3.5',
  '@tylix/core': '^0.3.5',
  '@tylix/compiler': '^0.3.5',
  '@tylix/generator': '^0.3.5',
  '@tylix/orm': '^0.3.5',
  '@tylix/shared': '^0.3.5',
  '@tylix/auth': '^0.3.5',
  '@tylix/mail': '^0.3.5',
  'tylix-icons': '^0.3.5',
}

function buildDatabaseEnvLines(config) {
  const projectSlug = config.projectName
  const driver = config.database
  const dbPassword = config.databasePassword ?? ''

  switch (driver) {
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
        `declare function useApi<T = unknown>(\n  url: string,\n  options?: { method?: string; body?: unknown }\n): Promise<T>\n`,
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
        ...dbEnvLines,
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
        ...dbEnvLines.map((line) =>
          line.startsWith('DATABASE_PASSWORD=') ? 'DATABASE_PASSWORD=' : line,
        ),
        ``,
        `MAIL_DRIVER=log`,
        `MAIL_FROM=noreply@${config.projectName}.test`,
        `MAIL_HOST=`,
        `MAIL_PORT=`,
        `MAIL_USER=`,
        `MAIL_PASSWORD=`,
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

    await fs.writeFile(
      path.join(
        targetDir,
        'database',
        'migrations',
        `${Date.now()}_create_jobs_table.${ext}`,
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
        `${Date.now() + 1}_create_cache_table.${ext}`,
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
        `${Date.now() + 2}_create_mail_logs_table.${ext}`,
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

    await fs.mkdir(path.join(targetDir, 'app', 'seeders'), { recursive: true })

    await fs.writeFile(
      path.join(targetDir, 'app', 'seeders', `DatabaseSeeder.${ext}`),
      `export async function seed() {\n  // e.g.:\n  // await Post.create({ title: 'First post', body: '...' })\n}\n`,
    )

    // Only use file: links to the monorepo's own packages when we're
    // actually running from inside a dev checkout of the monorepo (the
    // sibling `packages/` dir exists on disk). Anyone who installed
    // create-tylix from the npm registry has no such directory next to
    // it -- for them, every dependency must resolve to a real published
    // version instead of a broken local path.
    const isDevMonorepoContext = await pathExists(MONOREPO_PACKAGES_DIR)

    const filePkg = (name) => `file:${path.join(MONOREPO_PACKAGES_DIR, name)}`

    const dependencies = isDevMonorepoContext
      ? {
          '@tylix/cli': filePkg('cli'),
          '@tylix/core': filePkg('core'),
          '@tylix/compiler': filePkg('compiler'),
          '@tylix/generator': filePkg('generator'),
          '@tylix/orm': filePkg('orm'),
          '@tylix/shared': filePkg('shared'),
          '@tylix/mail': filePkg('mail'),
          'tylix-icons': filePkg('tylix-icons'),
        }
      : {
          '@tylix/cli': PUBLISHED_VERSIONS['@tylix/cli'],
          '@tylix/core': PUBLISHED_VERSIONS['@tylix/core'],
          '@tylix/compiler': PUBLISHED_VERSIONS['@tylix/compiler'],
          '@tylix/generator': PUBLISHED_VERSIONS['@tylix/generator'],
          '@tylix/orm': PUBLISHED_VERSIONS['@tylix/orm'],
          '@tylix/shared': PUBLISHED_VERSIONS['@tylix/shared'],
          '@tylix/mail': PUBLISHED_VERSIONS['@tylix/mail'],
          'tylix-icons': PUBLISHED_VERSIONS['tylix-icons'],
        }

    if (config.authEnabled) {
      dependencies['@tylix/auth'] = isDevMonorepoContext
        ? filePkg('auth')
        : PUBLISHED_VERSIONS['@tylix/auth']
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
  } catch (err) {
    // Partial scaffold on disk is worse than no scaffold -- clean up
    // before letting the error bubble, so a retry starts from zero
    // instead of hitting "Directory already exists" on the next run.
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}
