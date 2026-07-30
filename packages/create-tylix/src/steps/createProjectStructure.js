import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')

export async function createProjectStructure(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const isTs = config.language === 'typescript'
  const ext = isTs ? 'ts' : 'js'

  const exists = await fs
    .access(targetDir)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    throw new Error(`Directory "${config.projectName}" already exists.`)
  }

  await fs.mkdir(targetDir, { recursive: true })

  if (isTs) {
    const tsconfigTemplate = await fs.readFile(
      path.join(PACKAGE_ROOT, 'src', 'templates', 'tsconfig.json.template'),
      'utf-8',
    )
    await fs.writeFile(path.join(targetDir, 'tsconfig.json'), tsconfigTemplate)

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
    path.join(targetDir, '.env'),
    [
      `PORT=3000`,
      `AUTH_SECRET=${crypto.randomUUID()}`,
      `DATABASE_DRIVER=${config.database.driver ?? config.database}`,
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
      `DATABASE_DRIVER=sqlite`,
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

  await fs.mkdir(path.join(targetDir, 'app', 'jobs'), { recursive: true })
  await fs.writeFile(
    path.join(targetDir, 'app', 'jobs', `SendWelcomeEmail.${ext}`),
    isTs
      ? `export const SendWelcomeEmail = {\n  async handle(payload: { userId: string | number; [key: string]: unknown }) {\n    // payload.userId, etc.\n  },\n}\n`
      : `export const SendWelcomeEmail = {\n  async handle(payload) {\n    // payload.userId, etc.\n  },\n}\n`,
  )

  await fs.mkdir(path.join(targetDir, 'app', 'seeders'), { recursive: true })
  await fs.writeFile(
    path.join(targetDir, 'app', 'seeders', `DatabaseSeeder.${ext}`),
    `export async function seed() {\n  // e.g.:\n  // await Post.create({ title: 'First post', body: '...' })\n}\n`,
  )
  // const dependencies = {
  //   '@tylix/cli': '^0.1.0',
  //   '@tylix/core': '^0.1.0',
  //   '@tylix/compiler': '^0.1.0',
  //   '@tylix/generator': '^0.1.0',
  //   '@tylix/orm': '^0.1.1',
  //   '@tylix/shared': '^0.1.1',
  //   'tylix-icons': '^0.1.0',
  // }
  // if (config.authEnabled) {
  //   dependencies['@tylix/auth'] = '^0.1.0'
  // }

  const MONOREPO_PACKAGES_DIR = path.join(MONOREPO_ROOT, 'packages')

  const dependencies = {
    '@tylix/cli': `file:${path.join(MONOREPO_PACKAGES_DIR, 'cli')}`,
    '@tylix/core': `file:${path.join(MONOREPO_PACKAGES_DIR, 'core')}`,
    '@tylix/compiler': `file:${path.join(MONOREPO_PACKAGES_DIR, 'compiler')}`,
    '@tylix/generator': `file:${path.join(MONOREPO_PACKAGES_DIR, 'generator')}`,
    '@tylix/orm': `file:${path.join(MONOREPO_PACKAGES_DIR, 'orm')}`,
    '@tylix/shared': `file:${path.join(MONOREPO_PACKAGES_DIR, 'shared')}`,
    'tylix-icons': `file:${(path.join(MONOREPO_PACKAGES_DIR), 'tylix-icons')}`,
  }
  if (config.authEnabled) {
    dependencies['@tylix/auth'] =
      `file:${path.join(MONOREPO_PACKAGES_DIR, 'auth')}`
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
}
