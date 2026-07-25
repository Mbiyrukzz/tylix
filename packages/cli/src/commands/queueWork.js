import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JobRecord } from '@tylix/core'

async function loadJobHandler(baseDir, jobName) {
  const jobPath = path.join(baseDir, 'app', 'jobs', `${jobName}.js`)
  const exists = await fs
    .access(jobPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    throw new Error(`No job handler found at app/jobs/${jobName}.js`)
  }
  const mod = await import(pathToFileURL(jobPath).href)
  const handler = mod[jobName]
  if (!handler || typeof handler.handle !== 'function') {
    throw new Error(
      `app/jobs/${jobName}.js must export "${jobName}" with a handle(payload) method`,
    )
  }
  return handler
}

export async function queueWork() {
  const baseDir = process.cwd()
  console.log('Queue worker running — polling every 2s for pending jobs...\n')

  let isPolling = false

  setInterval(async () => {
    if (isPolling) return // don't overlap if a batch is still processing
    isPolling = true

    try {
      const pending = await JobRecord.query()
        .where('status', 'pending')
        .orderBy('id', 'ASC')
        .limit(5)
        .get()

      for (const job of pending) {
        await JobRecord.update(job.id, { status: 'processing' })

        try {
          const handler = await loadJobHandler(baseDir, job.job)
          await handler.handle(JSON.parse(job.payload))
          await JobRecord.update(job.id, { status: 'done' })
        } catch (err) {
          await JobRecord.update(job.id, {
            status: 'failed',
            attempts: (job.attempts ?? 0) + 1,
            error: err.message,
          })
          console.error(`Job #${job.id} (${job.job}) failed:`, err.message)
        }
      }
    } catch (err) {
      console.error('Queue polling error:', err.message)
    } finally {
      isPolling = false
    }
  }, 2000)
}
