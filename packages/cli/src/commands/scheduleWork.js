// packages/cli/src/commands/scheduleWork.js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Scheduler } from '@tylix/core'

export async function scheduleWork() {
  const baseDir = process.cwd()
  const scheduler = new Scheduler()
  const schedulePath = path.join(baseDir, 'app', 'schedule.js')
  const mod = await import(pathToFileURL(schedulePath).href)
  await mod.schedule(scheduler)

  console.log('Scheduler running — checking every 30s for due tasks...\n')
  setInterval(() => scheduler.runDue(), 30_000)
}
