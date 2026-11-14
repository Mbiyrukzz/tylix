/**
 * In-memory login attempt limiter, keyed by email.
 *
 * @deprecated Per-process and keyed only by account, so it neither holds
 * across servers nor resists someone locking a victim out. Use
 * createLoginThrottle({ store }) instead (per account+IP, per account and
 * per IP, over a shared store). Kept for apps generated before 1.5.
 */

const attempts = new Map()

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes
const MAX_KEYS = 50_000

function keyFor(identifier) {
  return String(identifier ?? '').trim().toLowerCase()
}

// Without this, every distinct email ever tried stays in memory forever.
function sweep(now) {
  for (const [key, record] of attempts) {
    const lockOver = !record.lockedUntil || record.lockedUntil <= now
    if (lockOver && now - record.firstAttemptAt > WINDOW_MS) attempts.delete(key)
  }
  while (attempts.size >= MAX_KEYS) attempts.delete(attempts.keys().next().value)
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
  if (attempts.size >= MAX_KEYS) sweep(now)
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
