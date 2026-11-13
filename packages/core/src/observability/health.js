// Readiness checks for /ready: whether this instance can serve traffic
// (the database answers, a cache or third-party API is reachable). A load
// balancer stops sending requests to an instance whose /ready fails.
//
//   addReadinessCheck('payments', async () => { await stripe.ping() })
//
// A check passes by returning; it fails by throwing (or taking longer
// than its timeout).
const checks = new Map()

export function addReadinessCheck(name, check, { timeoutMs = 2000 } = {}) {
  checks.set(name, { check, timeoutMs })
  return () => checks.delete(name)
}

export async function runReadinessChecks() {
  const results = {}
  await Promise.all(
    [...checks].map(async ([name, { check, timeoutMs }]) => {
      const startedAt = performance.now()
      let timer
      try {
        await Promise.race([
          check(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
          }),
        ])
        results[name] = { ok: true, ms: Math.round(performance.now() - startedAt) }
      } catch (err) {
        results[name] = { ok: false, ms: Math.round(performance.now() - startedAt), error: err?.message ?? String(err) }
      } finally {
        clearTimeout(timer)
      }
    }),
  )
  return { ok: Object.values(results).every((r) => r.ok), checks: results }
}
