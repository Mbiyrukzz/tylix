export class Scheduler {
  constructor() {
    this.tasks = []
  }

  every(interval, handler) {
    this.tasks.push({
      type: 'interval',
      interval: parseInterval(interval),
      handler,
      lastRun: 0,
    })
    return this
  }

  daily(time, handler) {
    const [hour, minute] = time.split(':').map(Number)
    this.tasks.push({ type: 'daily', hour, minute, handler, lastRunDate: null })
    return this
  }

  async runDue() {
    const now = new Date()
    for (const task of this.tasks) {
      if (
        task.type === 'interval' &&
        now.getTime() - task.lastRun >= task.interval
      ) {
        task.lastRun = now.getTime()
        await task.handler()
      }
      if (task.type === 'daily') {
        const today = now.toISOString().slice(0, 10)
        if (
          now.getHours() === task.hour &&
          now.getMinutes() === task.minute &&
          task.lastRunDate !== today
        ) {
          task.lastRunDate = today
          await task.handler()
        }
      }
    }
  }
}

function parseInterval(str) {
  const match = /^(\d+)(s|m|h)$/.exec(str)
  if (!match)
    throw new Error(
      `Invalid interval "${str}", expected e.g. "5m", "30s", "1h"`,
    )
  const [, num, unit] = match
  const multipliers = { s: 1000, m: 60000, h: 3600000 }
  return Number(num) * multipliers[unit]
}
