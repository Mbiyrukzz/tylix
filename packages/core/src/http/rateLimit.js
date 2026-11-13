import { getStore } from '../store/index.js'

// Rate limiting by key (an IP address, an email).
//
// By default the counts live in this process (sliding window), and the
// limiter answers synchronously:
//   const limit = createRateLimiter({ max: 5, windowMs: 60_000 })
//   if (!limit(ip).allowed) ...
//
// With store: 'shared' the counts live in the app's store, so every worker
// and server counts together (fixed window). The limiter then answers with
// a Promise, so await it:
//   const limit = createRateLimiter({ name: 'login', max: 5, windowMs: 60_000, store: 'shared' })
//   if (!(await limit(ip)).allowed) ...
export function createRateLimiter({ max, windowMs, store, name }) {
  if (store) return sharedLimiter({ max, windowMs, store, name })
  return memoryLimiter({ max, windowMs })
}

function memoryLimiter({ max, windowMs }) {
  const hits = new Map()
  let lastSweep = Date.now()

  return function check(key) {
    const now = Date.now()

    // Drop keys that have gone quiet so the map can't grow without bound.
    if (now - lastSweep > windowMs) {
      for (const [k, times] of hits) {
        if (times.every((t) => now - t >= windowMs)) hits.delete(k)
      }
      lastSweep = now
    }

    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)

    if (recent.length >= max) {
      hits.set(key, recent)
      const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000))
      return { allowed: false, retryAfterSeconds }
    }

    recent.push(now)
    hits.set(key, recent)
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

function sharedLimiter({ max, windowMs, store, name }) {
  if (!name) throw new Error('createRateLimiter({ store }) needs a name, so every process counts under the same key.')
  return async function check(key) {
    const now = Date.now()
    const windowStart = Math.floor(now / windowMs) * windowMs
    const target = store === 'shared' ? getStore() : store
    const count = await target.increment(`ratelimit:${name}:${key}:${windowStart}`, { ttlMs: windowMs })
    if (count > max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) }
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }
}
