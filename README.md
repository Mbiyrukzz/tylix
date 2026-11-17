# Tylix

> **Build full-stack JavaScript applications**

Tylix is a batteries-included full-stack JavaScript framework: its own
reactive `.tyx` pages, or React, Vue, Svelte or Angular on the front; a
server with authentication, an ORM, queues, channels and observability
built in; and a generator-first CLI that ties it together.

---

## Why Tylix?

Modern web development often means assembling a dozen libraries before the
first feature. With Tylix they already work together.

* ⚡ Reactive `.tyx` compiler, or React, Vue, Svelte and Angular
* 🖥️ Server-side rendering for every frontend
* 🔐 Authentication: sessions, email verification, password reset
* 🛡️ Roles and permissions for any JS framework: wildcards, inheritance, denies, teams, an admin page (`tylix make:permissions`)
* 📲 Installable, offline-ready PWAs for every frontend (`tylix make:pwa`)
* ⏳ A branded loading screen while pages start, in light and dark
* 🗄️ ORM for SQLite, PostgreSQL, MySQL, MariaDB, CockroachDB and MongoDB, with observers and traits
* 🧱 Migrations with indexes, foreign keys, column changes and rollbacks
* ✅ Validation shared by the API and the browser
* 🔗 A typed API client generated from your routes
* 📬 Queues with retries and backoff, scheduled tasks, live channels and mail
* 📈 Laravel-style log channels, request ids, metrics, health checks
* 🧩 Plugins, static site export and deployment adapters
* 🧵 Several workers or servers acting as one (shared store, `--workers`)
* 🚀 Generators for features, pages, components, jobs and more
* 🎨 537 icons for every frontend in `tylix-icons`
* 🩺 `tylix doctor` and 🖥️ `tylix tinker`

---

**Status: stable (2.0).** Tylix follows [semantic versioning](https://semver.org):
2.x releases add features and fix bugs without breaking your app; anything
that would break it waits for 3.0. See the [changelog](CHANGELOG.md), and
[Upgrading from 1.x](#upgrading-from-1x).

---

# Installation

```bash
npm create tylix@latest
```

Requires Node.js 22.13 or later. The installer asks for:

* Frontend: native Tylix, React, Vue, Svelte or Angular
* JavaScript or TypeScript
* SQLite, PostgreSQL, MySQL, MariaDB, CockroachDB or MongoDB
* Authentication
* Styling (every project starts from the Starter App)
* Installable app (PWA), also `--pwa`

---

# Start Development

```bash
cd my-app
npm run dev
```

Visit `http://localhost:3000`.

Saving a file shows up in the browser without restarting anything: pages,
components, styles and `app/index.html` reload the open tab; a new or
deleted page is routed; backend files (controllers, models, routes,
`.env`, `tylix.config`) restart the server, and the tab reloads once it is
back. React, Vue, Svelte and Angular frontends hot-reload through Vite.

---

# Example Page

A native Tylix page:

```tyx
page Home

state
  count: 0

computed
  doubled() {
    return this.count * 2
  }

action
  increment() {
    this.count++
  }

template
  <div>
    <h1>Counter</h1>
    <p>Count: {{ count }}, doubled: {{ doubled }}</p>
    <button onclick="{{ increment }}">Increment</button>
  </div>
```

With React, Vue, Svelte or Angular, pages are ordinary components. Data
comes from providers, and API calls live in services, so pages only
render:

```jsx
import { usePublicPosts } from '../providers/PostsProvider'

export default function Posts() {
  const { posts, loading } = usePublicPosts()
  return loading ? <p>Loading…</p> : posts.map((post) => <p key={post.id}>{post.title}</p>)
}
```

---

# Generate a Feature

```bash
tylix make:feature Post title:string body:text total:number
```

Generates a model, a migration, a validator and a CRUD API under
`/api/posts`, immediately usable.

---

# ORM

```javascript
const posts = await Post.where('published', true)
  .orderBy('created_at', 'DESC')
  .limit(10)
  .get()
```

Observers (`created`, `updated`, ...), traits (`use(Model, Searchable({ fields: ['title'] }))`),
pagination and atomic `updateWhere` are built in.

Drivers: `sqlite`, `postgres`, `mysql`, `mariadb`, `cockroach` and `mongodb`
(`DATABASE_DRIVER` in `.env`). CockroachDB uses the PostgreSQL driver and
counts ids 1, 2, 3 like everyone else. `DATABASE_URL` and `DATABASE_SSL=true`
connect PostgreSQL or CockroachDB to a hosted cluster.

## Migrations

```javascript
export const up = async (schema) => {
  await schema.createTable('posts', (table) => {
    table.increments('id')
    table.string('title', 200).notNullable()
    table.string('slug').unique()
    table.enum('status', ['draft', 'published']).default('draft').index()
    table.decimal('price', 10, 2).default(0)
    table.foreignId('user_id').constrained().cascadeOnDelete()
    table.timestamps()
    table.index(['status', 'created_at'])
  })
}

export const down = async (schema) => {
  await schema.dropTable('posts')
}
```

A later migration changes the table:

```javascript
export const up = async (schema) => {
  await schema.alterTable('posts', (table) => {
    table.string('subtitle').nullable()                    // add
    table.string('title', 500).notNullable().change()      // change type, null, default
    table.renameColumn('body', 'content')
    table.dropIndex(['status'])                            // by columns or name
    table.dropForeign(['user_id'])
    table.dropColumn('legacy')
  })
}
```

Every column type works on every SQL database. MySQL and MariaDB keep
indexes inside `CREATE TABLE`. SQLite can't change a column in place, so
it rebuilds the table, keeping its rows, indexes and foreign keys.
`hasTable`, `hasColumn`, `renameTable` and `raw` are there too, and so are
Laravel's names (`schema.create`, `schema.table`, `schema.dropIfExists`).
On MongoDB, indexes, renames and dropped fields apply, and the rest is
ignored.

```bash
tylix make:migration add_status_to_posts_table status:string:index:required:default=draft
tylix make:migration create_tags_table name:string:unique
tylix make:migration tune_posts --table=posts      # an empty alterTable
tylix migrate
tylix migrate:status
tylix migrate:rollback            # the last batch; --step=2 for the last two migrations
tylix migrate:refresh --seed      # roll everything back, migrate, seed
tylix migrate:fresh               # drop every table, migrate (--force in production)
```

Field modifiers (`make:feature`, `field:add`, `make:migration`): `unique`,
`index`, `required`, `nullable`, `default=<value>`. On SQLite and
PostgreSQL each migration runs in a transaction, so one that fails
changes nothing.

---

# Validation

```javascript
import { validate, required, isEmail, minLength } from '@tylix/shared/validation'

const result = validate(req.body, {
  email: [required, isEmail],
  password: [required, minLength(8)],
})
```

The same rules run in the browser: the starters' login and register forms
import the app's own `AuthValidator`.

---

# Authentication

Enable it when creating the project and Tylix generates the models,
controller, validator and mailer, plus login, register, password reset and
dashboard pages for your frontend.

```
POST   /api/register
POST   /api/login
POST   /api/auth/logout
POST   /api/auth/refresh
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
GET    /api/auth/verify-email
GET    /api/me
```

Sessions use httpOnly cookies with refresh tokens, stay in sync across
tabs, and survive server rendering. Sign-up and password-reset limits are
shared by every worker.

---

# Background Work and Live Updates

```javascript
import { dispatch, broadcast, cache } from '@tylix/core'

await dispatch('SendWelcomeEmail', { userId })      // tylix queue:work
await broadcast('chat', { text: 'Deploy finished' }) // tylix channels:work
const stats = await cache.remember('stats', 60, computeStats)
```

## Job retries with backoff

```javascript
// app/jobs/SendInvoice.js            (tylix make:job SendInvoice)
export const SendInvoice = {
  tries: 3,                       // attempts in total
  backoff: [10, 60, 300],         // seconds before each retry; or 30, or 'exponential'
  timeout: 120,                   // an attempt that takes longer counts as failed
  async handle(payload, job) { /* job.attempt is 1, 2, 3 */ },
  async failed(payload, error) { /* once, after the last attempt */ },
}

await dispatch('SendInvoice', { invoiceId }, { delay: 60 })  // run in a minute
```

`queue: { tries, backoff, timeout }` in `tylix.config` (or `QUEUE_TRIES`,
`QUEUE_BACKOFF`, `QUEUE_TIMEOUT`) sets the defaults. Throw a
`PermanentJobError` to fail without retrying. `tylix queue:failed` lists
failed jobs, `tylix queue:retry <id|all>` queues them again, and
`tylix queue:flush` deletes them. Apps made before 2.0 run
`tylix make:queue-retries && tylix migrate` once to add the `available_at`
column that delays need.

---

# Logging

Log channels work the way they do in Laravel:

```javascript
import { Log } from '@tylix/core'

Log.info('Invoice sent', { invoiceId: 12 })
Log.warning('Disk almost full', { pct: 91 })
Log.channel('payments').error('Charge failed', { error })
Log.stack(['daily', 'slack']).critical('Payments are down')
Log.withContext({ tenant: 3 })          // added to every later entry
```

The eight levels are `debug`, `info`, `notice`, `warning`, `error`,
`critical`, `alert` and `emergency`. The default `stack` channel writes to
the console and to a daily file, `storage/logs/tylix-2026-11-15.log`:

```
[2026-11-15 10:22:01] production.ERROR: Charge failed {"orderId":7} {"requestId":"4d36..."}
[stacktrace]
Error: card declined
    at ...
```

```javascript
// tylix.config
logging: {
  default: 'stack',                                       // LOG_CHANNEL
  channels: {
    stack: { driver: 'stack', channels: ['console', 'daily'] },  // LOG_STACK
    daily: { driver: 'daily', path: 'storage/logs/tylix.log', days: 14 },  // LOG_DAILY_DAYS
    payments: { driver: 'single', path: 'storage/logs/payments.log', level: 'warning' },
    slack: { driver: 'custom', via: (config) => ({ write(entry) { /* send it */ } }) },
  },
}
```

Drivers: `stack`, `single`, `daily`, `console`, `stderr`, `null`, `custom`,
plus any registered with `Log.extend('name', factory)` or by a plugin.
`tylix log:tail [channel] [--level=error]` follows a log file, and
`tylix log:clear` empties the log files.

---

# Typed API Client

The routes the app registers become a typed client. `tylix dev` writes it
when it starts, and `tylix routes:types` writes it on demand (`--check`
fails CI when it is stale). The client goes in `app/views/api.generated.ts`
for React, Vue, Svelte and Angular, and the types go in
`app/types/api.d.ts` for native pages.

```typescript
import { routes } from './api.generated'

const page = await routes.posts.index({ query: { page: 2 } })   // ApiResult<Paginated<Post>>
const post = await routes.posts.show({ id: 7 })                 // ApiResult<{ data: Post }>
await routes.posts.update({ id: 7 }, { title: 'New title' })    // body typed as PostInput
await routes.login({ email, password })
await routes.$request('DELETE /api/posts/:id', { params: { id: 7 } })
```

Feature routes are typed from their fields, and auth routes from their
request bodies. Other routes are typed by their method and path
parameters. It runs on `api()` from `@tylix/client`, so session refresh
and the `{ ok, data, error }` results work the same way.

---

# Plugins

```javascript
// app/plugins/audit.js  (or plugins: [audit()] in tylix.config)
import { definePlugin } from '@tylix/core'

export default definePlugin({
  name: 'audit',
  config(config) { return { observability: { ...config.observability, slowRequestMs: 500 } } },
  register({ use, logger }) { use((req, res, next) => next()) },   // middleware
  routes(router, { auth }) { router.get('/api/audit', auth(listAudit)) },
  boot(app) {},
  close() {},
  logDrivers: { slack: (config) => ({ write(entry) {} }) },
  commands: { 'audit:prune': { description: 'Delete old rows', run(args) {} } },
  deployAdapters: { mycloud: { name: 'mycloud', label: 'My Cloud', files: () => ({ 'mycloud.json': '{}' }) } },
})
```

`plugins` in `tylix.config` takes plugin objects, package names, file
paths and `[specifier, options]` pairs. Files in `app/plugins/` are loaded
after them. Plugin routes come after the app's own routes, so the app
can override them. `tylix plugins` lists what each plugin adds, and
`tylix <command>` runs a plugin's command.

---

# Running in Production

```bash
npm run build
npx tylix migrate
npx tylix start --workers auto
```

* One process per CPU core, sharing the port; a crashed worker is replaced.
* `STORE_DRIVER=database` (default) or `redis` shares the cache, rate limits
  and channel messages between workers and servers.
* `/health` and `/ready` for load balancers; `/metrics` for Prometheus
  with `METRICS=true`.
* JSON logs carrying each request's `X-Request-Id`; warnings for slow
  requests and slow queries.

Every setting is documented in the generated `.env`, and `tylix doctor`
shows each value and where it came from.

## Deployment adapters

```bash
tylix deploy:init              # list the adapters
tylix deploy:init fly          # Dockerfile + fly.toml (web and queue processes)
```

Server adapters (they run `tylix start`): `docker`, `fly`, `render`,
`railway`, `pm2`. Static adapters (they publish `tylix export`):
`netlify`, `vercel`, `github-pages`, `cloudflare-pages`. Existing files
are kept unless you pass `--force`. Plugins can add adapters.

## Static site generation

```bash
tylix build && tylix export     # dist/static
```

`tylix export` runs the production app on a private port, renders `/`,
every page without parameters and every page linked from them, then
writes the HTML, the scripts, styles and images they use, `public/`, and
a `404.html`. Pages with parameters go in `export.paths`:

```javascript
// tylix.config
export: {
  paths: async () => (await Post.all()).map((post) => `/posts/${post.id}`),
  exclude: ['/dashboard'],
}
```

API routes are not exported, so a page that loads data in the browser
still needs the backend.

---

# CLI

```bash
tylix dev
tylix build
tylix start --workers auto
tylix check                    # parse and typecheck every .tyx file
tylix migrate

tylix make:feature Invoice title:string total:number
tylix make:page Reports --auth
tylix make:component StatCard
tylix make:job SendInvoice
tylix make:observer Audit --model User
tylix make:trait HasSlug
tylix make:channel chat

tylix queue:work
tylix queue:failed
tylix queue:retry all
tylix schedule:work
tylix channels:work

tylix log:tail --level=error
tylix routes:types
tylix export
tylix deploy:init fly
tylix plugins

tylix doctor
tylix tinker
```

`tylix check` reports every problem in your `.tyx` pages, components,
layouts and capabilities with its file, line and column, and exits 1 when
there are any. In TypeScript projects it typechecks too (`--typecheck` /
`--no-typecheck` to choose). `--format=json` is for scripts, and
`--format=github` prints annotations that show up on pull requests.
`tylix build` runs the same check.

---

# Editor and DevTools

* **VS Code**: install **Tylix (.tyx)** (`tylix.tyx-language`) from the
  Extensions view. It adds highlighting, snippets, and a language server
  with errors as you type, type checking, completion (members,
  capabilities, imported components), hover, go to definition and an
  outline, plus the Tylix Dark/Light color themes and a Tylix file and
  folder icon theme. Source: [`editors/vscode`](editors/vscode)
  (`npm run build:editor` builds `tylix.vsix`).
* **Other editors**: [`@tylix/language-server`](packages/language-server)
  runs over stdio (`tylix-language-server --stdio`). Its README has Neovim
  and Helix setup.
* **Error overlay**: under `tylix dev`, a compile error opens a page with
  the failing file (the component or capability itself, not the page that
  used it), line and column underlined, every other problem in that file,
  and an *Open in editor* link. It reloads by itself when you save a fix.
  Uncaught errors in the browser show in a dismissible overlay.
* **Tylix DevTools**: a Chrome and Firefox extension (Chrome Web Store:
  *Tylix DevTools*; source in [`devtools/extension`](devtools/extension)). It adds a *Tylix* panel that
  shows the live page, layout, components and capabilities. You can edit
  state, run actions, and highlight a component on the page. Run
  `npm run build` there and load `devtools/extension/dist` unpacked. It
  works on pages served by `tylix dev` and asks for no site permissions.

---

# Project Structure

```
app/
├── controllers/      request handlers
├── models/           one class per table
├── routes/           API routes (web.js)
├── services/         business logic
├── middleware/
├── validators/       rules shared with the frontend
├── jobs/             background work
├── observers/        code that runs when models change
├── traits/           reusable model behaviour
├── mail/
├── seeders/
├── plugins/          plugins loaded at start
├── pages/            native .tyx pages
└── views/            React, Vue, Svelte or Angular (app/frontend before 2.0)
    ├── pages/
    ├── providers/
    ├── services/
    └── api.generated.ts   typed API client

database/migrations/
storage/logs/         daily log files
tests/
public/
tylix.config.js
```

Each folder has a README saying what goes there and which command makes it.

---

# Packages

| Package | |
| --- | --- |
| [`create-tylix`](packages/create-tylix) | creates an app |
| [`@tylix/cli`](packages/cli) | the `tylix` command |
| [`@tylix/core`](packages/core) | server, router, store, cache, queue, channels, observability |
| [`@tylix/orm`](packages/orm) | models and database adapters |
| [`@tylix/shared`](packages/shared) | validation, settings, naming helpers |
| [`@tylix/auth`](packages/auth) | authentication |
| [`@tylix/mail`](packages/mail) | email |
| [`@tylix/pdf`](packages/pdf) | PDF documents: tables, charts, QR codes, HTML, Unicode fonts; any JS runtime |
| [`@tylix/excel`](packages/excel) | Excel (.xlsx) and CSV, writing and reading; any JS runtime |
| [`@tylix/compiler`](packages/compiler) | the `.tyx` compiler |
| [`@tylix/language-server`](packages/language-server) | `.tyx` language server for any LSP editor |
| [`@tylix/generator`](packages/generator) | code generators |
| [`@tylix/client`](packages/client) | browser client: API, session, channels |
| [`@tylix/react`](packages/react), [`@tylix/vue`](packages/vue), [`@tylix/svelte`](packages/svelte), [`@tylix/angular`](packages/angular) | frontend bindings and SSR |
| [`tylix-icons`](packages/tylix-icons) | icons for every frontend |
| [`@tylix/charts`](packages/charts) | SVG charts for `.tyx` pages |

---

# Roadmap

## Done

* Reactive compiler and runtime, file-based pages, hot reload
* React, Vue, Svelte and Angular frontends with server-side rendering
* ORM for SQLite, PostgreSQL, MySQL, MariaDB, CockroachDB and MongoDB; observers and traits
* Migrations with indexes, foreign keys, column changes and rollbacks
* Authentication, validation shared with the browser
* Queues, scheduler, channels, mail
* Logs, metrics, health checks; workers and a shared store
* Feature generator, doctor, tinker, benchmarks (`bench/`)
* VS Code extension and language server, DevTools panel, `tylix check`
* Typed API client generated from the routes
* Job retries with backoff
* Laravel-style log channels
* Static site generation
* Plugin system
* Deployment adapters

---

# Upgrading from 1.x

```bash
npm install @tylix/cli@^2 @tylix/core@^2 @tylix/orm@^2 @tylix/shared@^2   # and any other @tylix/* you use
npx tylix make:queue-retries && npx tylix migrate                     # once: the column job delays need
```

* **`app/frontend` is now `app/views`** for React, Vue, Svelte and Angular.
  Nothing has to move: when only `app/frontend` exists, every command uses
  it. To rename it, also change `app/frontend` in your `package.json`
  scripts and Tailwind `content` globs.
* **Logs also go to files.** The default `stack` channel writes to the
  console and to `storage/logs/tylix-<date>.log`. Add `storage/logs/*.log`
  to `.gitignore`, or set `LOG_STACK=console` where files aren't wanted
  (containers, read-only disks).
* **Jobs** keep running once each, as before, unless a job or `queue` in
  `tylix.config` sets `tries`. Until the `available_at` migration runs,
  retries happen at once and `dispatch(..., { delay })` throws.
* **Migrations** you already have run unchanged, and columns are still
  nullable unless you say `notNullable()`. The `migrations` table gets a
  `batch` column the first time `tylix migrate` runs.
* **`tylix dev` writes a typed API client** (`app/views/api.generated.ts`,
  or `app/types/api.d.ts` for native pages). Set `typedRoutes: false` in
  `tylix.config` to turn that off.
* **create-tylix** has no Blank template; `--template blank` creates the
  Starter App.

---

# Contributing

```bash
git clone https://github.com/Mbiyrukzz/tylix.git
cd tylix
npm install
npm test
```

* `npm run test:e2e -- <url>` runs the browser checks against a running app.
* `npm run test:e2e:frontends` scaffolds the React, Vue, Svelte, Angular and
  native starters from this checkout and runs the browser checks (auth,
  routing, SSR, hydration, hot reload, error pages) against each, under
  `tylix dev` and `tylix start`. `--only react,vue` picks some.
* `npm run test:compat` runs each frontend adapter's tests against the
  oldest and newest framework major it supports.
* `npm run verify` is the release check: unit tests, then the frontend
  matrix.
* `npm run test:editor` builds the VS Code extension (language server
  bundled), runs its grammar tests and runs the LSP protocol test against
  the bundle.
* `npm run bench` compares the server with Node, Fastify, Hono and Express.
* `npm run release -- <version> bump|dry|publish` versions and publishes
  every package together.

Contributions, ideas and bug reports are welcome.

---

# License

[MIT](LICENSE)
