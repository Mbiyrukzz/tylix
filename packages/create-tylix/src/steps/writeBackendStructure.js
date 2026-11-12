import fs from 'node:fs/promises'
import path from 'node:path'

// The backend layout every Tylix app gets, whatever its frontend: one
// folder per kind of server code, each with a short guide (which also keeps
// empty folders in git), an example middleware, an API test, and a README
// for the project.

const FRONTEND_NAMES = { tylix: 'Tylix (.tyx pages)', react: 'React', svelte: 'Svelte', vue: 'Vue', angular: 'Angular' }

// Folder -> what goes there and which command makes it.
const GUIDES = {
  'app/controllers': [
    'Controllers',
    'Classes whose methods handle requests: read req.params / req.query / req.body, call models or services, and answer with res.json(...) or res.status(code).json(...).',
    'tylix make:controller Invoice',
    'Wire them to URLs in app/routes/web.EXT.',
  ],
  'app/models': [
    'Models',
    'One class per database table, built on @tylix/orm: Post.all(), Post.find(1), Post.where("status", "draft").get(), Post.create({...}).',
    'tylix make:model Invoice   (or tylix make:feature for model + migration + CRUD API)',
  ],
  'app/routes': [
    'Routes',
    'web.EXT is loaded at startup: publicRoutes(router) is open to everyone, protectedRoutes(router) requires a logged-in user (the framework adds the check). Any other file here that exports routes(router) is mounted too.',
    'tylix make:api Invoice',
    'API routes live under /api/. Pages are served by the frontend.',
  ],
  'app/services': [
    'Services',
    'Business logic that more than one controller, job or command needs: billing, imports, sending notifications. Keep controllers thin and put the work here.',
    'tylix make:service Billing',
    'Services are loaded into "tylix tinker" by name, so you can try them there.',
  ],
  'app/middleware': [
    'Middleware',
    'Functions (req, res, next) that run around requests: logging, rate limits, headers, tenant lookup. Register one for every request with router.use(fn) in publicRoutes(), or pass it to a single route.',
    'See logRequests.EXT for an example.',
  ],
  'app/validators': [
    'Validators',
    'Rules for incoming data, e.g. validate(req.body, { title: [required, isString] }) from @tylix/shared. Controllers answer 422 with the errors.',
    'tylix make:validator Invoice title:string total:number',
  ],
  'app/jobs': [
    'Jobs',
    'Work that shouldn\'t make a request wait: emails, exports, webhooks. Each file exports an object with handle(payload).',
    'Queue one: dispatch("SendWelcomeEmail", { userId }) from @tylix/core. Run them: tylix queue:work',
  ],
  'app/mail': [
    'Mail',
    'Mailables (subject, view, data) and app/mail/mailer.EXT, which sends them. MAIL_DRIVER=log in .env records mail instead of sending it (see /dev/mail in development).',
    'tylix make:mail Invoice',
  ],
  'app/seeders': [
    'Seeders',
    'DatabaseSeeder.EXT fills the database with starting or sample data.',
    'tylix db:seed',
  ],
  tests: [
    'Tests',
    'API tests with Node\'s built-in test runner. createTestClient() from @tylix/cli/testing calls your routes in-process, as a guest or as any user (client.get(url, { as: user })), with no server running.',
    'npm test',
  ],
}

function guide(folder, ext) {
  const [title, what, command, more] = GUIDES[folder]
  const lines = [`# ${title}`, '', what.replaceAll('EXT', ext), '', `Command: \`${command.replaceAll('EXT', ext)}\``]
  if (more) lines.push('', more.replaceAll('EXT', ext))
  return lines.join('\n') + '\n'
}

const MIDDLEWARE = {
  ts: `import type { TylixRequest, TylixResponse } from '@tylix/core'

// Logs every request with its status and duration:
//   GET /api/posts 200 4ms
// Register it in app/routes/web.ts, inside publicRoutes():
//   router.use(logRequests)
export async function logRequests(req: TylixRequest, res: TylixResponse, next: () => Promise<void>) {
  const started = performance.now()
  await next()
  const ms = Math.round(performance.now() - started)
  console.log(\`\${req.method} \${String(req.url).split('?')[0]} \${res.statusCode} \${ms}ms\`)
}
`,
  js: `// Logs every request with its status and duration:
//   GET /api/posts 200 4ms
// Register it in app/routes/web.js, inside publicRoutes():
//   router.use(logRequests)
export async function logRequests(req, res, next) {
  const started = performance.now()
  await next()
  const ms = Math.round(performance.now() - started)
  console.log(\`\${req.method} \${String(req.url).split('?')[0]} \${res.statusCode} \${ms}ms\`)
}
`,
}

function apiTest({ authEnabled, posts, ts }) {
  const cases = [`test('an unknown API route answers 404', async () => {
  const res = await client.get('/api/does-not-exist')
  assert.equal(res.status, 404)
})`]
  if (posts) {
    cases.push(`test('public posts are open to everyone', async () => {
  const res = await client.get('/api/public/posts')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.data))
})`)
  }
  if (authEnabled) {
    cases.push(`test('the current user needs a login', async () => {
  const res = await client.get('/api/me')
  assert.equal(res.status, 401)
})

// With a user in the database, call routes as them:
//   const user = await User.first()
//   const res = await client.get('/api/me', { as: user })
//   assert.equal(res.status, 200)`)
  }
  return `import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTestClient${ts ? ', type TestClient' : ''} } from '@tylix/cli/testing'

// Runs against the database in .env. Point tests at their own database
// with a separate env file, e.g. DATABASE_FILENAME=database.test.sqlite.

let client${ts ? ': TestClient' : ''}
before(async () => {
  client = await createTestClient()
})
after(async () => {
  await client.close()
})

${cases.join('\n\n')}
`
}

function readme(config, ext) {
  const hosted = config.frontend !== 'tylix'
  const frontend = FRONTEND_NAMES[config.frontend] ?? config.frontend
  const pages = hosted
    ? `app/frontend/         ${frontend} app: pages/, components/, entry-server (SSR)`
    : `app/pages/            .tyx pages (the file name is the URL) and components/`
  return `# ${config.projectName}

A Tylix app: ${frontend} pages on a Tylix backend (API, database, auth, mail, jobs).

## Run it

\`\`\`sh
npm run dev        # http://localhost:3000, reloads on save
npm test           # API tests in tests/
npm run doctor     # checks config, database, migrations and frontend
npm run tinker     # a REPL with your models, services and request()
npm run build      # typecheck and production bundles
npm start          # production server (after build and migrate)
\`\`\`

## Layout

\`\`\`
${pages}
app/routes/           API routes (web.${ext}); everything under /api/
app/controllers/      request handlers
app/models/           one class per table
app/services/         business logic shared by controllers and jobs
app/middleware/       functions that run around requests
app/validators/       rules for incoming data
app/jobs/             background work (tylix queue:work)
app/mail/             mailables and the mailer
app/Features/         CRUD features made by tylix make:feature
app/schedule.${ext}         scheduled tasks (tylix schedule:work)
app/seeders/          sample data (tylix db:seed)
database/migrations/  schema changes (tylix migrate)
tests/                API tests
public/               static files, served as-is
\`\`\`

Each folder has a README saying what goes there and which command makes it.

## Make things

\`\`\`sh
tylix make:feature Invoice title:string total:number   # model, migration, CRUD API
tylix make:page Reports --auth                          # a page and its route
tylix make:component StatCard
tylix make:service Billing
tylix make:controller Invoice
\`\`\`
`
}

export async function writeBackendStructure(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const isTs = config.language === 'typescript'
  const ext = isTs ? 'ts' : 'js'
  const write = async (file, content) => {
    const full = path.join(targetDir, file)
    await fs.mkdir(path.dirname(full), { recursive: true })
    // Never replace what an earlier step (or a generator) already wrote.
    await fs.writeFile(full, content, { flag: 'wx' }).catch((err) => {
      if (err.code !== 'EEXIST') throw err
    })
  }

  for (const folder of Object.keys(GUIDES)) {
    await write(path.join(folder, 'README.md'), guide(folder, ext))
  }
  await write(`app/middleware/logRequests.${ext}`, isTs ? MIDDLEWARE.ts : MIDDLEWARE.js)
  await write(
    `tests/api.test.${ext}`,
    apiTest({ authEnabled: config.authEnabled, posts: config.authEnabled && config.starter === 'starter', ts: isTs }),
  )
  await write('README.md', readme(config, ext))
}
