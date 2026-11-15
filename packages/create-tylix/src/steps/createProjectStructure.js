import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { getPackageManager } from '../utils/packageManager.js'

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

// Ambient types for the framework-injected globals in TypeScript projects.
// useApi returns the { ok, status, data, error } wrapper, not the data.
const GLOBALS_DTS_SOURCE = `interface ApiOptions {
  headers?: Record<string, string>
  credentials?: RequestCredentials
  // Abort after this many milliseconds. 0 or omitted means no timeout.
  timeout?: number
  signal?: AbortSignal
}

interface TylixApiResult<T = any> {
  ok: boolean
  status: number
  data: T
  error: string | null
}

declare function useApi<T = any>(
  url: string,
  options?: ApiOptions & { method?: string; body?: unknown }
): Promise<TylixApiResult<T>>

declare function reactive<T extends object>(state: T): T

declare function notFound(): void
`

// Published version pins, used whenever we're NOT running from inside
// the monorepo (e.g. someone ran `npx create-tylix` after installing
// it from the registry). Bump these as real versions get published.
const PUBLISHED_VERSIONS = {
  '@tylix/cli': '^2.0.0',
  '@tylix/core': '^2.0.0',
  '@tylix/compiler': '^2.0.0',
  '@tylix/generator': '^2.0.0',
  '@tylix/orm': '^2.0.0',
  '@tylix/shared': '^2.0.0',
  '@tylix/auth': '^2.0.0',
  '@tylix/mail': '^2.0.0',
  '@tylix/pdf': '^2.0.0',
  '@tylix/excel': '^2.0.0',
  'tylix-icons': '^2.0.0',
  '@tylix/client': '^2.0.0',
  '@tylix/react': '^2.0.0',
  '@tylix/svelte': '^2.0.0',
  '@tylix/vue': '^2.0.0',
  '@tylix/angular': '^2.0.0',
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
  '@tylix/pdf': 'pdf',
  '@tylix/excel': 'excel',
  '@tylix/auth': 'auth',
  'tylix-icons': 'tylix-icons',
  '@tylix/client': 'client',
  '@tylix/react': 'react',
  '@tylix/svelte': 'svelte',
  '@tylix/vue': 'vue',
  '@tylix/angular': 'angular',
}

// What each hosted frontend adds to package.json. `tylix` packages are
// linked like the rest (file: links in the monorepo, versions otherwise);
// the others come from the registry. `typecheck` is the frontend half of
// the TypeScript project's "typecheck" script.
const HOSTED_FRONTENDS = {
  react: {
    tylix: ['@tylix/client', '@tylix/react'],
    dependencies: {
      react: '^19.2.0',
      'react-dom': '^19.2.0',
      'react-router': '^7.9.0',
    },
    devDependencies: {
      vite: '^8.0.0',
      '@vitejs/plugin-react': '^6.0.0',
    },
    tsDevDependencies: {
      '@types/react': '^19.2.0',
      '@types/react-dom': '^19.2.0',
    },
    typecheck: 'tsc --noEmit -p app/views',
  },
  svelte: {
    tylix: ['@tylix/client', '@tylix/svelte'],
    dependencies: {},
    // Svelte compiles away at build time, so it's a dev dependency.
    devDependencies: {
      vite: '^8.0.0',
      svelte: '^5.46.0',
      '@sveltejs/vite-plugin-svelte': '^7.0.0',
    },
    tsDevDependencies: {
      'svelte-check': '^4.0.0',
    },
    typecheck: 'svelte-check --tsconfig app/views/tsconfig.json --threshold error',
  },
  vue: {
    tylix: ['@tylix/client', '@tylix/vue'],
    dependencies: {
      vue: '^3.5.0',
      'vue-router': '^5.0.0',
    },
    devDependencies: {
      vite: '^8.0.0',
      '@vitejs/plugin-vue': '^6.0.0',
    },
    tsDevDependencies: {
      'vue-tsc': '^3.0.0',
    },
    typecheck: 'vue-tsc --noEmit -p app/views',
  },
  angular: {
    tylix: ['@tylix/client', '@tylix/angular'],
    dependencies: {
      '@angular/common': '^22.2.0',
      '@angular/compiler': '^22.2.0',
      '@angular/core': '^22.2.0',
      '@angular/forms': '^22.2.0',
      '@angular/platform-browser': '^22.2.0',
      '@angular/platform-server': '^22.2.0',
      '@angular/router': '^22.2.0',
      rxjs: '^7.8.0',
      tslib: '^2.8.0',
    },
    devDependencies: {
      vite: '^8.0.0',
      '@analogjs/vite-plugin-angular': '^2.9.0',
      '@angular/build': '^22.2.0',
      '@angular/compiler-cli': '^22.2.0',
    },
    tsDevDependencies: {
      // Angular 22's compiler needs TypeScript 6.0.
      typescript: '~6.0.0',
    },
    typecheck: 'ngc -p app/views/tsconfig.json --noEmit',
  },
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

// Shared by .env and .env.example. Requests with a bigger body get a 413.
// Uploads (receipts, images) need this raised. Read by Server in @tylix/core.
const MAX_BODY_ENV_LINES = [
  `# Largest request body the server accepts, in bytes (1048576 = 1 MB).`,
  `# Bigger requests get a 413 response. Raise it if your app accepts uploads.`,
  `MAX_BODY_BYTES=1048576`,
]

function buildDebugEnvLines(value) {
  return [
    `# Shows real error details (SQL, stack traces, request data) in the browser`,
    `# and API responses. Keep false in production: it leaks internals.`,
    `APP_DEBUG=${value}`,
  ]
}

// APP_ENV is "local" for a fresh scaffold and "production" in the example
// file, so a copied .env.example is safe by default. APP_NAME, APP_ENV and
// LOG_LEVEL are written for your own code to read; the Server in @tylix/core
// reads APP_URL.
function buildAppEnvLines(config, env) {
  return [
    `# Which environment this app runs in: local, staging or production.`,
    `APP_ENV=${env}`,
    `APP_NAME=${formatEnvValue(config.projectName)}`,
    `# Public URL of the app. Used for links in emails and redirects, and it`,
    `# counts as a trusted origin for browser write requests.`,
    `APP_URL=${env === 'local' ? 'http://localhost:3000' : ''}`,
    `# error, warn, info or debug`,
    `LOG_LEVEL=${env === 'local' ? 'debug' : 'info'}`,
  ]
}

// "Continue with Google / GitHub". Empty = that button shows a "not
// available yet" message. Only written when the app has authentication.
function buildOAuthEnvLines(config, env) {
  if (!config.authEnabled) return []
  const base = env === 'local' ? 'http://localhost:3000' : '<APP_URL>'
  return [
    ``,
    `# Social sign-in. Create an OAuth app with each provider and paste its`,
    `# credentials here. The callback URL to register is shown per provider.`,
    `# Google (https://console.cloud.google.com/apis/credentials)`,
    `#   callback: ${base}/api/auth/oauth/google/callback`,
    `GOOGLE_CLIENT_ID=`,
    `GOOGLE_CLIENT_SECRET=`,
    `# GitHub (https://github.com/settings/developers)`,
    `#   callback: ${base}/api/auth/oauth/github/callback`,
    `GITHUB_CLIENT_ID=`,
    `GITHUB_CLIENT_SECRET=`,
  ]
}

// Settings the Server in @tylix/core reads. AUTO_PORT moves to the next free
// port when PORT is taken: handy in development, wrong in production where a
// reverse proxy expects a fixed port.
function buildServerEnvLines(env) {
  const local = env === 'local'
  return [
    `# Move to the next free port when PORT is already in use.`,
    `AUTO_PORT=${local ? 'true' : 'false'}`,
    `# How many following ports to try when AUTO_PORT is on.`,
    `PORT_ATTEMPTS=10`,
    ``,
    `# Extra origins allowed to send browser write requests (POST, PUT, ...),`,
    `# comma separated. Example: https://admin.example.com,https://app.example.com`,
    `TRUSTED_ORIGINS=`,
    ``,
    `# Content-Security-Policy: off, report-only or enforce. Leave empty for the`,
    `# default (off in development, report-only in production).`,
    `CSP_MODE=`,
    ``,
    `# Logging: LOG_LEVEL debug, info, warn, error or silent. LOG_FORMAT json`,
    `# (one JSON line per entry, for log collectors) or pretty. Empty: info,`,
    `# and json in production, pretty in development.`,
    `LOG_LEVEL=`,
    `LOG_FORMAT=`,
    `# Requests and SQL statements slower than these (ms) are logged as`,
    `# warnings. 0 turns a warning off.`,
    `SLOW_REQUEST_MS=1000`,
    `SLOW_QUERY_MS=200`,
    ``,
    `# Prometheus metrics at /metrics. With METRICS_TOKEN set, scrapers send`,
    `# "Authorization: Bearer <token>"; without it only this machine may read`,
    `# them. /health and /ready are always on.`,
    `METRICS=false`,
    `METRICS_TOKEN=`,
    ``,
    `# Where rate limits, the cache and channel messages live: database (this`,
    `# app's database; shared by every process), redis (fastest for heavy`,
    `# traffic; npm install redis) or memory (this process only).`,
    `STORE_DRIVER=database`,
    `REDIS_URL=`,
    `STORE_PREFIX=`,
    `# Processes "tylix start" runs, sharing the port: a number, or auto for`,
    `# one per CPU core.`,
    `WORKERS=${env === 'local' ? '1' : 'auto'}`,
  ]
}

function buildMailEnvLines(config) {
  return [
    `# log | smtp | resend | sendgrid | postmark | mailgun | ses`,
    `MAIL_DRIVER=log`,
    `MAIL_FROM=noreply@${config.projectName}.test`,
    `# smtp`,
    `MAIL_HOST=`,
    `MAIL_PORT=`,
    `MAIL_SECURE=false`,
    `MAIL_USER=`,
    `MAIL_PASSWORD=`,
    `# resend, sendgrid, postmark, mailgun (and MAIL_DOMAIN for mailgun)`,
    `MAIL_API_KEY=`,
    `MAIL_DOMAIN=`,
    `# mailgun region (us | eu) or the AWS region for ses`,
    `MAIL_REGION=`,
  ]
}

// loadEnv (in @tylix/shared) trims every value and strips exactly one pair
// of matching outer quotes, with no escape handling. Most values are
// written as they are, so the file stays readable and other tools can read
// it too. A value that would not survive that round trip -- leading or
// trailing spaces, or one that itself starts and ends with the same quote
// character -- is wrapped in double quotes, which loadEnv removes again.
function formatEnvValue(value) {
  const text = String(value ?? '')

  if (/[\r\n]/.test(text)) {
    throw new Error('Values written to .env cannot contain a line break.')
  }

  const wrappedInQuotes =
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))

  return text !== text.trim() || wrappedInQuotes ? `"${text}"` : text
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
  const dbPassword = formatEnvValue(config.databasePassword ?? '')

  switch (driver) {
    case 'sqlite':
      return [`DATABASE_DRIVER=sqlite`, `DATABASE_FILENAME=database.sqlite`]
    case 'postgres':
      return [
        `DATABASE_DRIVER=postgres`,
        `DATABASE_HOST=127.0.0.1`,
        `DATABASE_PORT=5432`,
        `DATABASE_USER=${formatEnvValue(config.databaseUser || 'postgres')}`,
        `DATABASE_PASSWORD=${dbPassword}`,
        `DATABASE_NAME=${projectSlug}`,
      ]
    case 'cockroach':
      return [
        `DATABASE_DRIVER=cockroach`,
        `DATABASE_HOST=127.0.0.1`,
        `DATABASE_PORT=26257`,
        `DATABASE_USER=${formatEnvValue(config.databaseUser || 'root')}`,
        `DATABASE_PASSWORD=${dbPassword}`,
        `DATABASE_NAME=${projectSlug}`,
        `# CockroachDB Cloud: set DATABASE_URL=postgresql://... (it wins over the values above)`,
        `# and DATABASE_SSL=true.`,
      ]
    case 'mysql':
    case 'mariadb':
      return [
        `DATABASE_DRIVER=${driver}`,
        `DATABASE_HOST=127.0.0.1`,
        `DATABASE_PORT=3306`,
        `DATABASE_USER=${formatEnvValue(config.databaseUser || 'root')}`,
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

// pnpm 11 stopped reading the "pnpm" field in package.json. Its settings
// now live in pnpm-workspace.yaml, even for a single project. This builds
// that file's text. JSON.stringify produces valid YAML double-quoted
// strings, so names like "@tylix/core" and paths survive without extra
// escaping.
//
// The build-script allowlist is written twice on purpose:
//   allowBuilds           read by pnpm 11+
//   onlyBuiltDependencies read by pnpm 10.6+
// Each version ignores the key it does not know.
function buildPnpmWorkspaceYaml({ buildable, overrides }) {
  const lines = []

  if (buildable.length) {
    lines.push(`# Dependencies allowed to run install scripts (native builds).`)
    lines.push(`allowBuilds:`)
    for (const name of buildable) {
      lines.push(`  ${JSON.stringify(name)}: true`)
    }
    lines.push(``)
    lines.push(`# Same list for pnpm 10.6+, which uses the older setting name.`)
    lines.push(`onlyBuiltDependencies:`)
    for (const name of buildable) {
      lines.push(`  - ${JSON.stringify(name)}`)
    }
    lines.push(``)
  }

  if (overrides) {
    lines.push(`# Local testing only: resolve every @tylix/* package to the`)
    lines.push(`# local checkout, including transitive ones.`)
    lines.push(`overrides:`)
    for (const [name, spec] of Object.entries(overrides)) {
      lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
    }
    lines.push(``)
  }

  return lines.join('\n')
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
  const pm = getPackageManager(config)
  // A hosted frontend (React, Svelte) has no .tyx pages, so none of the
  // native page helpers (useApi globals, app/useApi, app/pages) are written.
  const hostedFrontend = HOSTED_FRONTENDS[config.frontend] ?? null
  const hosted = hostedFrontend !== null

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
      // The React code has its own tsconfig (DOM types, JSX) in
      // app/views, so the backend config leaves that folder out.
      const tsconfig = hosted
        ? JSON.stringify(
            { ...JSON.parse(tsconfigTemplate), exclude: ['app/views'] },
            null,
            2,
          ) + '\n'
        : tsconfigTemplate
      await fs.writeFile(path.join(targetDir, 'tsconfig.json'), tsconfig)

      // Ambient declarations for the framework-injected globals.
      // Without this, every generated .ts file that calls useApi() fails
      // with "Cannot find name 'useApi'" (TS2304).
      if (!hosted) {
        await fs.mkdir(path.join(targetDir, 'app', 'types'), { recursive: true })
        await fs.writeFile(
          path.join(targetDir, 'app', 'types', 'globals.d.ts'),
          GLOBALS_DTS_SOURCE,
        )
      }
    }

    await fs.mkdir(path.join(targetDir, 'app', 'models'), { recursive: true })
    await fs.mkdir(path.join(targetDir, 'app', 'controllers'), {
      recursive: true,
    })
    await fs.mkdir(path.join(targetDir, 'app', 'Features'), { recursive: true })
    if (!hosted) {
      await fs.mkdir(path.join(targetDir, 'app', 'pages'), { recursive: true })
    }
    await fs.mkdir(path.join(targetDir, 'database', 'migrations'), {
      recursive: true,
    })
    await fs.mkdir(path.join(targetDir, 'public'), { recursive: true })

    await fs.mkdir(path.join(targetDir, 'app', 'routes'), { recursive: true })
    await fs.writeFile(
      path.join(targetDir, 'app', 'routes', `web.${ext}`),
      isTs
        ? `import type { Router } from '@tylix/core'\n\n// Open to everyone.\nexport async function publicRoutes(router: Router) {\n  // router.use(someMiddleware) // global: runs before every route\n  // router.get('/health', (req, res) => res.json({ ok: true }))\n}\n\n// Every route here requires a logged-in user. The framework adds the check.\nexport async function protectedRoutes(router: Router) {\n  // router.get('/api/reports', (req, res) => reports.index(req, res))\n}\n`
        : `// Open to everyone.\nexport async function publicRoutes(router) {\n  // router.use(someMiddleware) // global: runs before every route\n  // router.get('/health', (req, res) => res.json({ ok: true }))\n}\n\n// Every route here requires a logged-in user. The framework adds the check.\nexport async function protectedRoutes(router) {\n  // router.get('/api/reports', (req, res) => reports.index(req, res))\n}\n`,
    )

    // API helpers. Each takes an optional last `options` argument that is
    // passed to useApi (headers, credentials, timeout, signal). method and
    // body are set after the spread, so options cannot override them.
    // Native pages only: a React app calls api() from @tylix/react.
    if (!hosted) {
      await fs.mkdir(path.join(targetDir, 'app', 'useApi'), { recursive: true })
      await fs.writeFile(
        path.join(targetDir, 'app', 'useApi', `getApi.${ext}`),
        isTs
          ? `export const getApi = (table: string, options?: ApiOptions) =>\n  useApi(\`/api/\${table}\`, options)\n`
          : `export const getApi = (table, options) => useApi(\`/api/\${table}\`, options)\n`,
      )
      await fs.writeFile(
        path.join(targetDir, 'app', 'useApi', `postApi.${ext}`),
        isTs
          ? `export const postApi = (table: string, data: unknown, options?: ApiOptions) =>\n  useApi(\`/api/\${table}\`, { ...options, method: 'POST', body: data })\n`
          : `export const postApi = (table, data, options) =>\n  useApi(\`/api/\${table}\`, { ...options, method: 'POST', body: data })\n`,
      )
      await fs.writeFile(
        path.join(targetDir, 'app', 'useApi', `putApi.${ext}`),
        isTs
          ? `export const putApi = (\n  table: string,\n  id: number | string,\n  data: unknown,\n  options?: ApiOptions,\n) => useApi(\`/api/\${table}/\${id}\`, { ...options, method: 'PUT', body: data })\n`
          : `export const putApi = (table, id, data, options) =>\n  useApi(\`/api/\${table}/\${id}\`, { ...options, method: 'PUT', body: data })\n`,
      )
      await fs.writeFile(
        path.join(targetDir, 'app', 'useApi', `deleteApi.${ext}`),
        isTs
          ? `export const deleteApi = (table: string, id: number | string, options?: ApiOptions) =>\n  useApi(\`/api/\${table}/\${id}\`, { ...options, method: 'DELETE' })\n`
          : `export const deleteApi = (table, id, options) =>\n  useApi(\`/api/\${table}/\${id}\`, { ...options, method: 'DELETE' })\n`,
      )

      await fs.writeFile(
        path.join(targetDir, 'app', 'useApi', `createResource.${ext}`),
        isTs ? CREATE_RESOURCE_TS_SOURCE : CREATE_RESOURCE_JS_SOURCE,
      )
    }
    const dbEnvLines = buildDatabaseEnvLines(config)

    // .env holds the database password and AUTH_SECRET, so only the owner
    // can read it (Windows ignores the mode).
    await fs.writeFile(
      path.join(targetDir, '.env'),
      [
        `PORT=3000`,
        ``,
        ...buildAppEnvLines(config, 'local'),
        ``,
        ...buildServerEnvLines('local'),
        ``,
        `AUTH_SECRET=${crypto.randomBytes(32).toString('hex')}`,
        ...buildOAuthEnvLines(config, 'local'),
        ``,
        ...buildDebugEnvLines('true'),
        ``,
        ...dbEnvLines,
        ``,
        ...buildMailEnvLines(config),
        ``,
        ...TRUST_PROXY_ENV_LINES,
        ``,
        ...MAX_BODY_ENV_LINES,
        ``,
        `# Set to true only if you're developing @tylix/compiler itself`,
        `TYLIX_HOT_RELOAD_COMPILER=false`,
      ].join('\n') + '\n',
      { mode: 0o600 },
    )
    await fs.writeFile(
      path.join(targetDir, '.env.example'),
      [
        `PORT=3000`,
        ``,
        ...buildAppEnvLines(config, 'production'),
        ``,
        ...buildServerEnvLines('production'),
        ``,
        `AUTH_SECRET=`,
        ...buildOAuthEnvLines(config, 'production'),
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
        ...MAX_BODY_ENV_LINES,
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
        ? `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: Job\n *\n * Do not edit this section.\n */\n\nimport type { Schema, CreateTableBuilder } from '@tylix/shared'\n\nexport const up = async (schema: Schema) => {\n    await schema.createTable("jobs", (table: CreateTableBuilder) => {\n        table.increments("id");\n        table.string("job");\n        table.text("payload");\n        table.string("status");\n        table.integer("attempts");\n        table.text("error");\n        table.datetime("available_at");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema: Schema) => {\n    await schema.dropTable("jobs");\n};\n`
        : `/**\n * Generated by Tylix\n *\n * Generator: MigrationGenerator\n * Version: 0.1.0\n * Feature: Job\n *\n * Do not edit this section.\n */\n\nexport const up = async (schema) => {\n    await schema.createTable("jobs", (table) => {\n        table.increments("id");\n        table.string("job");\n        table.text("payload");\n        table.string("status");\n        table.integer("attempts");\n        table.text("error");\n        table.datetime("available_at");\n        table.timestamps();\n    });\n};\n\nexport const down = async (schema) => {\n    await schema.dropTable("jobs");\n};\n`,
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

    // Log files (the "daily" and "single" log channels). Kept in git as
    // an empty folder; the .log files themselves are ignored.
    await fs.mkdir(path.join(targetDir, 'storage', 'logs'), { recursive: true })
    await fs.writeFile(path.join(targetDir, 'storage', 'logs', '.gitkeep'), '')

    await fs.mkdir(path.join(targetDir, 'app', 'jobs'), { recursive: true })
    // An example job for apps without auth. With auth, the auth generator
    // writes a real SendWelcomeEmail, queued by its UserObserver.
    if (!config.authEnabled) {
      await fs.writeFile(
        path.join(targetDir, 'app', 'jobs', `SendWelcomeEmail.${ext}`),
        isTs
          ? `export const SendWelcomeEmail = {\n  async handle(payload: { userId: string | number; [key: string]: unknown }) {\n    // payload.userId, etc.\n  },\n}\n`
          : `export const SendWelcomeEmail = {\n  async handle(payload) {\n    // payload.userId, etc.\n  },\n}\n`,
      )
    }

    await fs.mkdir(path.join(targetDir, 'app', 'mail'), { recursive: true })

    // Capabilities are a .tyx feature; hosted frontends don't use them.
    if (!hosted) {
      await fs.mkdir(path.join(targetDir, 'app', 'capabilities'), { recursive: true })
    }

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
    if (hosted) {
      for (const name of hostedFrontend.tylix) {
        dependencies[name] = pkgSpec(name)
      }
      Object.assign(dependencies, hostedFrontend.dependencies)
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
    if (hosted) {
      Object.assign(devDependencies, hostedFrontend.devDependencies)
      if (isTs) Object.assign(devDependencies, hostedFrontend.tsDevDependencies)
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
      // API tests in tests/ with Node's test runner. TypeScript runs through
      // tsx, the same loader the tylix CLI uses for .ts app code.
      test: isTs
        ? 'node --import tsx --test "tests/**/*.test.ts"'
        : 'node --test "tests/**/*.test.js"',
      doctor: 'tylix doctor',
      tinker: 'tylix tinker',
    }
    if (config.styling === 'tailwind' && !hosted) {
      scripts['css:build'] =
        'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css'
      scripts['css:watch'] =
        'tailwindcss -i ./app/tailwind-input.css -o ./public/tailwind.css --watch'
    }
    if (isTs) {
      scripts.typecheck = hosted
        ? `tsc --noEmit && ${hostedFrontend.typecheck}`
        : 'tsc --noEmit'
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
    // the package manager mixes local copies with registry copies. The
    // override specs are identical to the direct dependency specs above,
    // which npm requires, otherwise it throws EOVERRIDE.
    const localOverrides = isDevMonorepoContext
      ? Object.fromEntries(
          Object.keys(LOCAL_PACKAGE_DIRS).map((name) => [name, filePkg(name)]),
        )
      : null

    if (pm === 'pnpm') {
      // pnpm 11 no longer reads the "pnpm" field in package.json, so its
      // settings go in pnpm-workspace.yaml instead. Native packages need
      // their install scripts allowed, or pnpm stops with
      // ERR_PNPM_IGNORED_BUILDS.
      const buildable = []
      if (config.database === 'sqlite') buildable.push('better-sqlite3')
      if (isTs || hosted) buildable.push('esbuild')

      const workspaceYaml = buildPnpmWorkspaceYaml({
        buildable,
        overrides: localOverrides,
      })
      if (workspaceYaml) {
        await fs.writeFile(
          path.join(targetDir, 'pnpm-workspace.yaml'),
          workspaceYaml,
        )
      }
    } else if (localOverrides) {
      // npm reads a top-level `overrides` field in package.json.
      packageJson.overrides = localOverrides
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

    // The Tylix logo. The SVG mark is what the navbar uses; the PNGs are
    // for places that need a bitmap (emails, social cards). favicon.ico is
    // a real multi-size icon, since browsers request it even without a
    // <link> tag.
    for (const [from, to] of [
      ['logo-mark.svg', 'logo-mark.svg'],
      ['logo-mark.png', 'logo-mark.png'],
      ['logo-full.png', 'logo-full.png'],
      ['favicon.svg', 'favicon.svg'],
      ['logo-mark.png', 'favicon.png'],
      ['favicon.ico', 'favicon.ico'],
    ]) {
      await fs.copyFile(
        path.join(PACKAGE_ROOT, 'assets', from),
        path.join(targetDir, 'public', to),
      )
    }

    return targetDir
  } catch (err) {
    // Partial scaffold on disk is worse than no scaffold -- clean up
    // before letting the error bubble, so a retry starts from zero
    // instead of hitting "Directory already exists" on the next run.
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}