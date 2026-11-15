// Retry rules for queued jobs, as in Laravel. A job handler may set:
//
//   export const SendInvoice = {
//     tries: 5,                     // attempts in total (default: queue.tries, 1)
//     backoff: [10, 60, 300],       // seconds before attempt 2, 3, 4 (the last repeats)
//     // backoff: 30                // the same wait every time
//     // backoff: 'exponential'     // 1s, 2s, 4s, 8s ... with jitter, capped at maxBackoff
//     // backoff: (attempt) => attempt * 10
//     maxBackoff: 3600,             // cap for 'exponential' (seconds)
//     timeout: 120,                 // seconds; a slower attempt counts as failed
//     async handle(payload, job) {},
//     async failed(payload, error, job) {},   // once, after the last attempt fails
//   }
//
// Throw an error with `retryable: false` (or a PermanentJobError) to fail
// at once, without the remaining attempts.

export class PermanentJobError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'PermanentJobError'
    this.retryable = false
  }
}

export class JobTimeoutError extends Error {
  constructor(seconds) {
    super(`Job timed out after ${seconds}s`)
    this.name = 'JobTimeoutError'
  }
}

export const QUEUE_DEFAULTS = { tries: 1, backoff: 0, maxBackoff: 3600, timeout: 0 }

function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

// The job's settings: its own, then the queue config, then the defaults.
export function jobOptions(handler = {}, defaults = {}) {
  const base = { ...QUEUE_DEFAULTS, ...defaults }
  return {
    tries: Math.max(1, Math.floor(positive(handler.tries ?? base.tries, 1))),
    backoff: handler.backoff ?? base.backoff,
    maxBackoff: positive(handler.maxBackoff ?? base.maxBackoff, 3600),
    timeout: positive(handler.timeout ?? base.timeout, 0),
  }
}

// Seconds to wait before the next attempt, after `attempt` (1-based)
// attempts have failed.
export function backoffSeconds(options, attempt, random = Math.random) {
  const { backoff, maxBackoff } = options
  let seconds
  if (typeof backoff === 'function') seconds = backoff(attempt)
  else if (Array.isArray(backoff)) seconds = backoff.length ? backoff[Math.min(attempt, backoff.length) - 1] : 0
  else if (backoff === 'exponential') {
    const exact = Math.min(2 ** (attempt - 1), maxBackoff)
    // Full jitter on the upper half, so retries of many jobs spread out.
    seconds = exact / 2 + random() * (exact / 2)
  } else seconds = backoff
  return Math.min(positive(seconds, 0), Math.max(maxBackoff, 0) || Infinity)
}

// What the worker does after an attempt threw: retry later, or fail.
export function afterFailure(options, attempt, error, now = Date.now()) {
  const permanent = error?.retryable === false
  if (permanent || attempt >= options.tries) return { retry: false, attempt }
  const delay = backoffSeconds(options, attempt)
  return { retry: true, attempt, delaySeconds: delay, availableAt: new Date(now + delay * 1000) }
}

// Runs handle() with the job's timeout.
export async function runWithTimeout(work, seconds) {
  if (!seconds) return work()
  let timer
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new JobTimeoutError(seconds)), seconds * 1000)
        timer.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
