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
| `tylix migrate` | run database migrations |
| `tylix db:seed` | run `app/seeders` |
| `tylix queue:work` | run queued jobs (stops gracefully on SIGTERM) |
| `tylix schedule:work` | run `app/schedule` tasks |
| `tylix channels:work` | WebSocket channel server; relays `broadcast()` from the app |
| `tylix tinker [--eval "..."]` | a REPL with your models, services and routes |
| `tylix doctor` | checks the project, settings (and where each comes from), database and frontend |

## Make things

| Command | Creates |
| --- | --- |
| `tylix make:feature Invoice title:string total:number` | model, migration, validator, CRUD API |
| `tylix make:model`, `make:migration`, `make:controller`, `make:validator`, `make:service`, `make:api` | one piece at a time |
| `tylix make:page Reports [--auth]` | a page and its route, in your frontend's own format |
| `tylix make:component StatCard` | a component for your frontend |
| `tylix make:job SendInvoice` | a background job (`dispatch('SendInvoice', ...)`) |
| `tylix make:observer Audit --model User` | model lifecycle hooks, enabled on the model |
| `tylix make:trait HasSlug` | reusable model behaviour (`use(Model, HasSlug)`) |
| `tylix make:channel chat` | a channel and a demo page |
| `tylix make:mail Welcome`, `make:auth`, `make:icon` | mail, auth, icons |
| `tylix field:add` / `field:remove` | change a feature's fields with a migration |

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
