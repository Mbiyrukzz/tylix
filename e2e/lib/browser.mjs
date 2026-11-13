// Shared by the E2E scripts: the browser to drive, and a few helpers.
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

// playwright-core with a browser already on the machine. Set CHROMIUM_PATH
// if yours is somewhere else.
export async function launchBrowser() {
  const executablePath = CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p))
  if (!executablePath) {
    console.error('No Chromium found. Set CHROMIUM_PATH to a Chrome or Chromium binary.')
    process.exit(2)
  }
  return chromium.launch({ executablePath, headless: true })
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Resolves once `check` returns something truthy, or throws after `timeout`.
export async function waitFor(check, { timeout = 15000, interval = 200, what = 'condition' } = {}) {
  const until = Date.now() + timeout
  let lastError
  while (Date.now() < until) {
    try {
      const value = await check()
      if (value) return value
    } catch (err) {
      lastError = err
    }
    await sleep(interval)
  }
  throw new Error(`timed out waiting for ${what}${lastError ? ` (${lastError.message})` : ''}`)
}

// A list of named checks that keeps going after a failure, so one run
// reports everything that is broken.
export function createReport(title) {
  const results = []
  let failed = false
  return {
    async step(name, fn) {
      const started = Date.now()
      try {
        await fn()
        results.push(`  ✔ ${name} (${Date.now() - started}ms)`)
        return true
      } catch (err) {
        failed = true
        results.push(`  ✘ ${name}\n      ${String(err?.message ?? err).split('\n').slice(0, 6).join('\n      ')}`)
        return false
      }
    },
    get failed() {
      return failed
    },
    print() {
      console.log(title)
      console.log(results.join('\n'))
      console.log(failed ? '\nFAILED' : `\nALL ${results.length} CHECKS PASSED`)
    },
  }
}
