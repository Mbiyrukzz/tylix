# @tylix/core

The Tylix server runtime: HTTP server and router, log channels, metrics
and health checks, a shared store, cache, rate limiting, a queue with
retries, scheduler, channels and plugins. `tylix dev` and `tylix start` set all of it up from your
settings; import the pieces you use in app code.

```sh
npm install @tylix/core
```

## Server and router

```js
import { Router, Server } from '@tylix/core'

const router = new Router()
router.get('/api/posts/:id', (req, res) => res.json({ id: req.params.id }))
new Server(router).listen(3000)
```

Routes are looked up by path segment, so the cost doesn't grow with the
number of routes; when two routes match, the one registered first wins.
Responses get security headers, cross-site write protection and a
Content-Security-Policy (CSP_MODE). JSON of 1 KB or more is compressed
when the client accepts it.

## Logs, metrics and health

```js
import { logger, metrics, addReadinessCheck, currentRequest } from '@tylix/core'

logger.info('Invoice sent', { invoiceId: 12 })
metrics.counter('invoices_sent_total', 'Invoices sent').inc()
addReadinessCheck('payments', () => paymentsApi.ping())
```

- Every request gets an id (`X-Request-Id`), and log lines written while
  it runs carry it.
- Logs are JSON lines in production and readable lines in development
  (`LOG_LEVEL`, `LOG_FORMAT`). Requests slower than `SLOW_REQUEST_MS` and
  queries slower than `SLOW_QUERY_MS` are logged as warnings.
- `/health` and `/ready` are always on; `/metrics` (Prometheus format) with
  `METRICS=true`, guarded by `METRICS_TOKEN`.

## Log channels

```js
import { Log } from '@tylix/core'

Log.info('Invoice sent', { invoiceId: 12 })
Log.channel('payments').error('Charge failed', { error })
Log.stack(['daily', 'slack']).critical('Payments are down')
Log.withContext({ tenant: 3 })
Log.extend('slack', (config) => ({ write(entry) { /* send it */ } }))
```

The levels are Laravel's eight: `debug`, `info`, `notice`, `warning`,
`error`, `critical`, `alert` and `emergency`. The drivers are `stack`,
`single`, `daily` (rotated, keeping `days`), `console`, `stderr`, `null`
and `custom`, and each channel has its own minimum `level`. They are set
in `logging` in `tylix.config` or with `LOG_CHANNEL`, `LOG_STACK` and
`LOG_DAILY_DAYS`. Files go in `storage/logs/`, one line per entry:
`[2026-11-15 10:22:01] production.ERROR: Charge failed {"orderId":7} {"requestId":"..."}`.

## Store, cache and rate limits

One store holds the cache, shared rate limits and channel messages, so
several workers or servers act as one. `STORE_DRIVER`:

- `database` (default): the app's own database; nothing new to run
- `redis`: for heavy traffic (`REDIS_URL`; `npm install redis`)
- `memory`: one process only

```js
import { cache, createRateLimiter } from '@tylix/core'

const stats = await cache.remember('stats:home', 60, () => computeStats())

const limit = createRateLimiter({ name: 'login', max: 5, windowMs: 60_000, store: 'shared' })
if (!(await limit(req.ip)).allowed) return res.status(429).json({ error: 'Too many attempts.' })
```

Without `store`, a limiter counts in its own process and answers
synchronously.

## Queue, scheduler and channels

```js
import { dispatch, broadcast } from '@tylix/core'

await dispatch('SendInvoice', { invoiceId: 12 }) // run by tylix queue:work
await broadcast('chat', { text: 'Deploy finished' }) // to clients of tylix channels:work
```

Queue workers claim each job atomically, so several workers never run the
same job.

Jobs retry with backoff:

```js
export const SendInvoice = {
  tries: 3,
  backoff: [10, 60, 300],   // or 30, 'exponential', (attempt) => seconds
  timeout: 120,
  async handle(payload, { attempt }) {},
  async failed(payload, error) {},
}

await dispatch('SendInvoice', { invoiceId: 12 }, { delay: 60 })
```

Throw a `PermanentJobError` to fail without retrying. `jobOptions`,
`backoffSeconds` and `afterFailure` are the rules the worker uses.

## Plugins

```js
import { definePlugin } from '@tylix/core'

export default definePlugin({
  name: 'audit',
  register({ use, logger }) { use((req, res, next) => next()) },
  routes(router, { auth }) { router.get('/api/audit', auth(handler)) },
  logDrivers: { slack: (config) => ({ write(entry) {} }) },
  commands: { 'audit:prune': { run(args) {} } },
})
```

The hooks are `config`, `register`, `routes`, `boot` and `close`. Plugins
can also add `logDrivers`, `commands` and `deployAdapters`.
`loadPlugins(baseDir, config)` and `createPluginHost(plugins)` are what the
CLI uses.

## License

MIT
