import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JobRecord, logger } from '@tylix/core'
import { detectLanguage, loadConfig } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'
import { configureObservability } from '../server/observability.js'
import { openStore } from '../server/store.js'

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

export async function queueWork({ pollMs = 2000, batch = 5 } = {}) {
  const baseDir = process.cwd()
  console.log('Queue worker starting...')

  await bootstrapDatabase()
  const config = await loadConfig(baseDir, await detectLanguage(baseDir))
  configureObservability(config)
  // Jobs may use the cache or broadcast() to channels.
  await openStore(config, { role: 'queue' })

  console.log(`Queue worker running — polling every ${pollMs / 1000}s for pending jobs...\n`)

  let running = null
  let stopping = false

  async function runBatch() {
    const pending = await JobRecord.query().where('status', 'pending').orderBy('id', 'ASC').limit(batch).get()

    for (const job of pending) {
      if (stopping) return
      // Claim it: only one worker's update changes a pending job, so
      // several workers never run the same job.
      const claimed = await JobRecord.updateWhere({ id: job.id, status: 'pending' }, { status: 'processing' })
      if (claimed !== 1) continue

      const startedAt = Date.now()
      const log = logger.child({ job: job.job, jobId: job.id })
      log.info(`Job #${job.id} (${job.job}) started`)
      try {
        const handler = await loadJobHandler(baseDir, job.job)
        await handler.handle(JSON.parse(job.payload))
        await JobRecord.update(job.id, { status: 'done' })
        log.info(`Job #${job.id} (${job.job}) done in ${Math.round((Date.now() - startedAt) / 1000)}s`)
      } catch (err) {
        await JobRecord.update(job.id, {
          status: 'failed',
          attempts: (job.attempts ?? 0) + 1,
          error: err.message,
        })
        log.error(`Job #${job.id} (${job.job}) failed`, { error: err })
      }
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
