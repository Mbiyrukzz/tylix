// Observability for apps: the logger configured from the settings,
// slow-query warnings and database metrics, and the /health, /ready and
// /metrics endpoints.
import { ConnectionManager, onQuery } from '@tylix/orm'
import { addReadinessCheck, configureLogging, JobRecord, logger, metrics, runReadinessChecks } from '@tylix/core'

let stopQueryListener = null

// Applies config.observability and returns the Server options to match.
export function configureObservability(config) {
  const settings = config.observability
  logger.configure({ level: settings.logLevel, format: settings.logFormat })
  // Log channels (console, daily files in storage/logs, ...). The process
  // still starts when a channel is misconfigured: it logs to the console
  // and says what is wrong.
  try {
    if (config.logging) configureLogging(config.logging, { baseDir: config.baseDir ?? process.cwd(), environment: config.app?.env ?? 'local' })
    else logger.configure({ transports: null })
  } catch (err) {
    logger.configure({ transports: null })
    logger.error(`Logging config: ${err.message} Logging to the console only.`)
  }

  stopQueryListener?.()
  stopQueryListener = null
  const queryDuration = settings.metrics
    ? metrics.histogram('db_query_duration_seconds', 'Database statement duration by driver', [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5])
    : null
  if (settings.slowQueryMs > 0 || queryDuration) {
    stopQueryListener = onQuery(({ driver, sql, durationMs, error }) => {
      queryDuration?.observe(durationMs / 1000, { driver })
      if (settings.slowQueryMs > 0 && durationMs > settings.slowQueryMs && !error) {
        logger.warn('Slow query', { driver, ms: Math.round(durationMs), sql: sql.length > 500 ? `${sql.slice(0, 500)}…` : sql })
      }
    })
  }

  return {
    logger,
    accessLog: settings.accessLog,
    slowRequestMs: settings.slowRequestMs,
    metrics: settings.metrics ? metrics : null,
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

// /health: the process is up. /ready: it can serve (the database answers,
// plus any addReadinessCheck()). /metrics: Prometheus metrics, when on.
// Registered after the app's routes, so an app's own /health wins.
export function registerOperationsRoutes(router, config) {
  addReadinessCheck('database', () => ConnectionManager.getAdapter().ping())

  router.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) })
  })

  router.get('/ready', async (req, res) => {
    const result = await runReadinessChecks()
    res.setHeader('Cache-Control', 'no-store')
    res.status(result.ok ? 200 : 503).json({ status: result.ok ? 'ready' : 'unavailable', checks: result.checks })
  })

  if (!config.observability.metrics) return
  const token = config.observability.metricsToken
  const jobsPending = metrics.gauge('tylix_jobs_pending', 'Queued jobs waiting for a worker')
  router.get('/metrics', async (req, res) => {
    const allowed = token ? req.headers.authorization === `Bearer ${token}` : LOOPBACK.has(req.ip)
    if (!allowed) {
      res.status(403).json({
        error: token ? 'Send the METRICS_TOKEN as a bearer token.' : 'Set METRICS_TOKEN to read metrics from another machine.',
      })
      return
    }
    try {
      jobsPending.set(await JobRecord.query().where('status', 'pending').count())
    } catch {
      // no jobs table: nothing to report
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(metrics.render())
  })
}
