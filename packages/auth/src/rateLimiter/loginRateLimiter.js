/**
 * In-memory login attempt limiter, keyed by email.
 *
 * NOTE: this state lives in process memory. That's fine for a single
 * instance / dev, but it resets on restart and doesn't share state
 * across multiple server processes. If you deploy more than one
 * instance behind a load balancer, swap the Map below for Redis
 * (INCR + EXPIRE) using the same function signatures.
 */

const attempts = new Map()

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes

function keyFor(identifier) {
  return String(identifier ?? '').toLowerCase()
}

export function checkLoginAllowed(identifier) {
  const record = attempts.get(keyFor(identifier))
  if (!record) return { allowed: true }

  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((record.lockedUntil - Date.now()) / 1000),
    }
  }

  return { allowed: true }
}

export function recordFailedLogin(identifier) {
  const key = keyFor(identifier)
  const now = Date.now()
  const record = attempts.get(key) ?? {
    count: 0,
    firstAttemptAt: now,
    lockedUntil: null,
  }

  if (now - record.firstAttemptAt > WINDOW_MS) {
    record.count = 0
    record.firstAttemptAt = now
    record.lockedUntil = null
  }

  record.count += 1

  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS
  }

  attempts.set(key, record)
  return record
}

export function clearLoginAttempts(identifier) {
  attempts.delete(keyFor(identifier))
}
