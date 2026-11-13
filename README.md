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
* 🗄️ ORM for SQLite, PostgreSQL, MySQL and MongoDB, with observers and traits
* ✅ Validation shared by the API and the browser
* 📬 Queues, scheduled tasks, live channels and mail
* 📈 Request ids, structured logs, metrics, health checks
* 🧵 Several workers or servers acting as one (shared store, `--workers`)
* 🚀 Generators for features, pages, components, jobs and more
* 🎨 537 icons for every frontend in `tylix-icons`
* 🩺 `tylix doctor` and 🖥️ `tylix tinker`

---

**Status: stable (1.0).** Tylix follows [semantic versioning](https://semver.org):
1.x releases add features and fix bugs without breaking your app; anything
that would break it waits for 2.0. See the [changelog](CHANGELOG.md).

---

# Installation

```bash
npm create tylix@latest
```

Requires Node.js 22.13 or later. The installer asks for:

* Frontend: native Tylix, React, Vue, Svelte or Angular
* JavaScript or TypeScript
* SQLite, MySQL, PostgreSQL or MongoDB
* Authentication
* Styling and a starter template

---

# Start Development

```bash
cd my-app
npm run dev
```

Visit `http://localhost:3000`.

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

---

# CLI

```bash
tylix dev
tylix build
tylix start --workers auto
tylix migrate

tylix make:feature Invoice title:string total:number
tylix make:page Reports --auth
tylix make:component StatCard
tylix make:job SendInvoice
tylix make:observer Audit --model User
tylix make:trait HasSlug
tylix make:channel chat

tylix queue:work
tylix schedule:work
tylix channels:work

tylix doctor
tylix tinker
```

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
├── pages/            native .tyx pages
└── frontend/         React, Vue, Svelte or Angular
    ├── pages/
    ├── providers/
    └── services/

database/migrations/
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
| [`@tylix/compiler`](packages/compiler) | the `.tyx` compiler |
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
* ORM for SQLite, MySQL, PostgreSQL and MongoDB; observers and traits
* Authentication, validation shared with the browser
* Queues, scheduler, channels, mail
* Logs, metrics, health checks; workers and a shared store
* Feature generator, doctor, tinker, benchmarks (`bench/`)

## Planned

* Typed API client generated from the routes
* Job retries with backoff
* Static site generation
* Plugin system
* DevTools and a VS Code extension
* Deployment adapters

---

# Contributing

```bash
git clone https://github.com/Mbiyrukzz/tylix.git
cd tylix
npm install
npm test
```

* `npm run test:e2e -- <url>` runs the browser checks against a running app.
* `npm run bench` compares the server with Node, Fastify, Hono and Express.
* `npm run release -- <version> bump|dry|publish` versions and publishes
  every package together.

Contributions, ideas and bug reports are welcome.

---

# License

[MIT](LICENSE)
