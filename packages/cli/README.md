# @tylix/cli

The `tylix` command: development server, production server, builds,
migrations, generators, background workers and diagnostics.

```sh
npm install -D @tylix/cli    # new apps from create-tylix already have it
```

## Run

| Command | |
| --- | --- |
| `tylix dev [--port 3000]` | development server with hot reload |
| `tylix build` | production build (pages, TypeScript, the frontend bundle) |
| `tylix start [--port 3000] [--workers N\|auto]` | production server; with workers, one process per core sharing the port, replaced when one crashes |
| `tylix migrate` | run new migrations, as one batch |
| `tylix migrate:status` | which migrations have run, and in which batch |
| `tylix migrate:rollback [--step=N]` | undo the last batch (or the last N migrations) |
| `tylix migrate:reset` / `migrate:refresh [--seed]` / `migrate:fresh [--seed]` | undo all; undo and migrate; drop every table and migrate (`--force` in production) |
| `tylix db:seed` | run `app/seeders` |
| `tylix queue:work` | run queued jobs, with retries and backoff (stops gracefully on SIGTERM) |
| `tylix queue:failed` / `queue:retry <id\|all>` / `queue:flush` | list, retry, delete failed jobs |
| `tylix log:tail [channel] [--level=error]` / `log:clear` | follow or empty the log files |
| `tylix routes:types [--check]` | write the typed API client (`tylix dev` does it on start) |
| `tylix export [--out dir]` | static site: every page and its assets in `dist/static` |
| `tylix deploy:init <adapter> [--force]` | Docker, Fly, Render, Railway, PM2, Netlify, Vercel, GitHub Pages, Cloudflare Pages |
| `tylix plugins` | the plugins loaded and what each adds |
| `tylix schedule:work` | run `app/schedule` tasks |
| `tylix channels:work` | WebSocket channel server; relays `broadcast()` from the app |
| `tylix tinker [--eval "..."]` | a REPL with your models, services and routes |
| `tylix doctor` | checks the project, settings (and where each comes from), database and frontend |

## Make things

| Command | Creates |
| --- | --- |
| `tylix make:feature Invoice title:string total:number` | model, migration, validator, CRUD API |
| `tylix make:migration add_status_to_posts_table status:string:index:default=draft` | a migration; the name says what it does (`create_x_table`, `add_y_to_x_table`, `remove_y_from_x_table`, `--table=`, `--create=`) |
| `tylix make:model`, `make:controller`, `make:validator`, `make:service`, `make:api` | one piece at a time |
| `tylix make:queue-retries` | the `available_at` column retries need, for apps made before 2.0 |
| `tylix make:page Reports [--auth]` | a page and its route, in your frontend's own format |
| `tylix make:component StatCard` | a component for your frontend |
| `tylix make:job SendInvoice` | a background job (`dispatch('SendInvoice', ...)`) |
| `tylix make:observer Audit --model User` | model lifecycle hooks, enabled on the model |
| `tylix make:trait HasSlug` | reusable model behaviour (`use(Model, HasSlug)`) |
| `tylix make:channel chat` | a channel and a demo page |
| `tylix make:mail Welcome`, `make:auth`, `make:icon` | mail, auth, icons |
| `tylix field:add` / `field:remove` | change a feature's fields with a migration |

Fields take modifiers after their type: `slug:string:unique`,
`status:string:index:required:default=draft`, `bio:text:nullable`.

Commands that plugins add run as `tylix <command>`.

## Testing

```js
import { createTestClient } from '@tylix/cli/testing'

const client = await createTestClient()
const res = await client.get('/api/posts', { as: user })
```

Calls your routes in-process, with no server running.

TypeScript projects are detected from `tsconfig.json` and run through
`tsx`.

## License

MIT
