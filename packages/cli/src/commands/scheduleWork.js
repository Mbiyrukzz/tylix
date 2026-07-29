import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Scheduler } from '@tylix/core'
import { detectLanguage } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'

export async function scheduleWork() {
  const baseDir = process.cwd()

  await bootstrapDatabase()

  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'
  const schedulePath = path.join(baseDir, 'app', `schedule.${ext}`)

  const exists = await fs
    .access(schedulePath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    console.error(
      `No app/schedule.${ext} found at ${schedulePath}. Create one exporting an async "schedule(scheduler)" function.`,
    )
    process.exit(1)
  }

  const mod = await import(pathToFileURL(schedulePath).href)
  if (typeof mod.schedule !== 'function') {
    console.error(
      `app/schedule.${ext} must export an async function named "schedule(scheduler)".`,
    )
    process.exit(1)
  }

  const scheduler = new Scheduler()
  await mod.schedule(scheduler)

  console.log('Scheduler running — checking every 30s for due tasks...\n')
  setInterval(() => scheduler.runDue(), 30_000)
}
