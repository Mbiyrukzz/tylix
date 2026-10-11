// In-memory sliding-window limiter. Fine for a single server process;
// with several processes each one keeps its own counts.
export function createRateLimiter({ max, windowMs }) {
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
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((recent[0] + windowMs - now) / 1000),
      )
      return { allowed: false, retryAfterSeconds }
    }

    recent.push(now)
    hits.set(key, recent)
    return { allowed: true, retryAfterSeconds: 0 }
  }
}