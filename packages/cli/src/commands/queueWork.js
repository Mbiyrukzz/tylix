import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JobRecord, afterFailure, jobOptions, logger, runWithTimeout } from '@tylix/core'
import { detectLanguage, loadConfig } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'
import { configureObservability } from '../server/observability.js'
import { openStore } from '../server/store.js'
import { preparePlugins } from '../server/plugins.js'

async function loadJobHandler(baseDir, jobName) {
  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'

  const jobPath = path.join(baseDir, 'app', 'jobs', `${jobName}.${ext}`)
  const exists = await fs
    .access(jobPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    throw new Error(`No job handler found at app/jobs/${jobName}.${ext}`)
  }
  const mod = await import(pathToFileURL(jobPath).href)
  const handler = mod[jobName]
  if (!handler || typeof handler.handle !== 'function') {
    throw new Error(
      `app/jobs/${jobName}.${ext} must export "${jobName}" with a handle(payload) method`,
    )
  }
  return handler
}

// The queue section of tylix.config, with QUEUE_TRIES / QUEUE_BACKOFF /
// QUEUE_TIMEOUT from the environment on top. Each job may override them.
export function queueDefaults(config = {}, env = process.env) {
  const queue = { ...(config.queue ?? {}) }
  if (env.QUEUE_TRIES) queue.tries = Number(env.QUEUE_TRIES)
  if (env.QUEUE_TIMEOUT) queue.timeout = Number(env.QUEUE_TIMEOUT)
  if (env.QUEUE_BACKOFF) {
    const raw = env.QUEUE_BACKOFF.trim()
    queue.backoff = raw === 'exponential' ? raw : raw.includes(',') ? raw.split(',').map(Number) : Number(raw)
  }
  return queue
}

// Jobs tables made before 2.0 have no available_at column. The worker
// still retries there, just without waiting between attempts.
async function supportsDelays() {
  try {
    await JobRecord.query().whereNull('available_at').limit(1).get()
    return true
  } catch {
    return false
  }
}

// Pending jobs that may run now, oldest first.
async function dueJobs(batch, delays) {
  const pending = () => JobRecord.query().where('status', 'pending')
  if (!delays) return pending().orderBy('id', 'ASC').limit(batch).get()
  const [immediate, due] = await Promise.all([
    pending().whereNull('available_at').orderBy('id', 'ASC').limit(batch).get(),
    pending().where('available_at', '<=', new Date().toISOString()).orderBy('id', 'ASC').limit(batch).get(),
  ])
  return [...immediate, ...due].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, batch)
}

export async function queueWork({ pollMs = 2000, batch = 5 } = {}) {
  const baseDir = process.cwd()
  console.log('Queue worker starting...')

  await bootstrapDatabase()
  const config = await loadConfig(baseDir, await detectLanguage(baseDir))
  await preparePlugins(baseDir, config)
  configureObservability(config)
  // Jobs may use the cache or broadcast() to channels.
  await openStore(config, { role: 'queue' })

  const defaults = queueDefaults(config)
  const delays = await supportsDelays()
  if (!delays) {
    logger.warn('The jobs table has no available_at column, so retries run without backoff. Run "tylix make:queue-retries" then "tylix migrate".')
  }

  console.log(`Queue worker running — polling every ${pollMs / 1000}s for pending jobs...\n`)

  let running = null
  let stopping = false

  async function runJob(job) {
    const startedAt = Date.now()
    const attempt = (job.attempts ?? 0) + 1
    const log = logger.child({ job: job.job, jobId: job.id, attempt })
    let handler = null
    let options = jobOptions({}, defaults)
    let payload
    try {
      handler = await loadJobHandler(baseDir, job.job)
      options = jobOptions(handler, defaults)
      payload = JSON.parse(job.payload)
      const context = { id: job.id, attempt, tries: options.tries }
      log.info(`Job #${job.id} (${job.job}) started${options.tries > 1 ? ` (attempt ${attempt} of ${options.tries})` : ''}`)
      await runWithTimeout(() => Promise.resolve(handler.handle(payload, context)), options.timeout)
      await JobRecord.update(job.id, { status: 'done', attempts: attempt, error: null })
      log.info(`Job #${job.id} (${job.job}) done in ${Math.round((Date.now() - startedAt) / 1000)}s`)
    } catch (err) {
      const next = afterFailure(options, attempt, err)
      if (next.retry) {
        await JobRecord.update(job.id, {
          status: 'pending',
          attempts: attempt,
          error: err.message,
          ...(delays ? { available_at: next.availableAt.toISOString() } : {}),
        })
        log.warn(`Job #${job.id} (${job.job}) failed, retrying${delays && next.delaySeconds ? ` in ${Math.round(next.delaySeconds)}s` : ''}`, { error: err })
        return
      }
      await JobRecord.update(job.id, { status: 'failed', attempts: attempt, error: err.message })
      log.error(`Job #${job.id} (${job.job}) failed${attempt > 1 ? ` after ${attempt} attempts` : ''}`, { error: err })
      if (typeof handler?.failed === 'function') {
        try {
          await handler.failed(payload, err, { id: job.id, attempt, tries: options.tries })
        } catch (hookErr) {
          log.error(`Job #${job.id} (${job.job}) failed() hook threw`, { error: hookErr })
        }
      }
    }
  }

  async function runBatch() {
    const pending = await dueJobs(batch, delays)

    for (const job of pending) {
      if (stopping) return
      // Claim it: only one worker's update changes a pending job, so
      // several workers never run the same job.
      const claimed = await JobRecord.updateWhere({ id: job.id, status: 'pending' }, { status: 'processing' })
      if (claimed !== 1) continue
      await runJob(job)
    }
  }

  const timer = setInterval(() => {
    if (running || stopping) return
    running = runBatch()
      .catch((err) => logger.error('Queue polling error', { error: err }))
      .finally(() => {
        running = null
      })
  }, pollMs)

  // On SIGTERM (a deploy, Ctrl+C): take no new jobs, let the running one
  // finish, then exit. A second signal exits at once.
  const stop = async (signal) => {
    if (stopping) process.exit(1)
    stopping = true
    clearInterval(timer)
    console.log(`\n${signal}: finishing the current job, then stopping...`)
    await running
    process.exit(0)
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}

// tylix queue:failed: lists failed jobs.
export async function queueFailed({ limit = 50 } = {}) {
  await bootstrapDatabase()
  const failed = await JobRecord.query().where('status', 'failed').orderBy('id', 'DESC').limit(limit).get()
  if (failed.length === 0) {
    console.log('No failed jobs.')
    return
  }
  for (const job of failed) {
    const when = job.updated_at ? String(job.updated_at).replace('T', ' ').slice(0, 19) : ''
    console.log(`#${String(job.id).padEnd(6)} ${String(job.job).padEnd(24)} ${String(job.attempts ?? 0).padStart(2)} attempt(s)  ${when}`)
    if (job.error) console.log(`        ${String(job.error).split('\n')[0]}`)
  }
  console.log(`\nRetry with "tylix queue:retry <id>" or "tylix queue:retry all".`)
}

// tylix queue:retry <id ...|all>: puts failed jobs back on the queue, with
// their attempts reset.
export async function queueRetry(ids = []) {
  if (ids.length === 0) throw new Error('Usage: tylix queue:retry <id ...|all>')
  await bootstrapDatabase()
  const delays = await supportsDelays()
  const reset = { status: 'pending', attempts: 0, error: null, ...(delays ? { available_at: null } : {}) }
  let count = 0
  if (ids.includes('all')) {
    const failed = await JobRecord.query().where('status', 'failed').get()
    for (const job of failed) count += await JobRecord.updateWhere({ id: job.id, status: 'failed' }, reset)
  } else {
    for (const raw of ids) {
      const id = /^\d+$/.test(raw) ? Number(raw) : raw
      const changed = await JobRecord.updateWhere({ id, status: 'failed' }, reset)
      if (!changed) console.log(`⚠ Job #${raw} is not a failed job.`)
      count += changed
    }
  }
  console.log(count ? `✔ ${count} job(s) back on the queue.` : 'No jobs retried.')
}

// tylix queue:flush: deletes failed jobs.
export async function queueFlush() {
  await bootstrapDatabase()
  const failed = await JobRecord.query().where('status', 'failed').get()
  for (const job of failed) await JobRecord.delete(job.id)
  console.log(`✔ Deleted ${failed.length} failed job(s).`)
}
