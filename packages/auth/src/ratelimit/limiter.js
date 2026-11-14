import { sha256Hex } from '../core/crypto.js'
import { toSeconds } from '../core/keys.js'

// Rate limiting over any counter store:
//
//   { increment(key, { ttlMs }) -> Promise<number>, get(key), delete(key) }
//
// The Tylix store (getStore()) already has that shape; so does a thin
// wrapper around Redis (INCR + PEXPIRE) or Upstash. The default memory
// store is per-process: fine for one server, not for several.

const MAX_MEMORY_KEYS = 100_000

export function createMemoryCounterStore({ maxKeys = MAX_MEMORY_KEYS } = {}) {
  const entries = new Map()
  const live = (key) => {
    const e = entries.get(key)
    if (!e) return null
    if (e.expiresAt <= Date.now()) {
      entries.delete(key)
      return null
    }
    return e
  }
  const sweep = () => {
    const now = Date.now()
    for (const [k, e] of entries) if (e.expiresAt <= now) entries.delete(k)
    // Still too many (a flood of distinct keys): drop the oldest, so an
    // attacker can't exhaust memory by rotating identifiers.
    while (entries.size >= maxKeys) entries.delete(entries.keys().next().value)
  }
  return {
    async get(key) {
      return live(key)?.value ?? null
    },
    async increment(key, { by = 1, ttlMs = 60_000 } = {}) {
      const e = live(key)
      if (e) {
        e.value += by
        return e.value
      }
      if (entries.size >= maxKeys) sweep()
      entries.set(key, { value: by, expiresAt: Date.now() + ttlMs })
      return by
    },
    async delete(key) {
      entries.delete(key)
    },
  }
}

// Identifiers (emails, usernames) are hashed before they become store
// keys, so the counter store never holds a list of who tried to log in.
async function keyOf(name, identifier) {
  return `rl:${name}:${(await sha256Hex(String(identifier ?? '').trim().toLowerCase())).slice(0, 32)}`
}

/**
 * Fixed-window limiter. check() counts a hit; peek() only reads.
 *   const limit = createRateLimiter({ name: 'signup', max: 10, window: '1h' })
 *   const { allowed, retryAfterSeconds } = await limit.check(ip)
 */
export function createRateLimiter({ name, max, window, store = createMemoryCounterStore() }) {
  if (!name) throw new TypeError('createRateLimiter needs a name')
  if (!Number.isInteger(max) || max < 1) throw new TypeError('createRateLimiter needs max >= 1')
  const windowMs = toSeconds(window, 'window') * 1000

  const slot = async (identifier) => {
    const start = Math.floor(Date.now() / windowMs) * windowMs
    return { key: `${await keyOf(name, identifier)}:${start}`, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - Date.now()) / 1000)) }
  }

  return {
    async check(identifier, { cost = 1 } = {}) {
      const { key, retryAfterSeconds } = await slot(identifier)
      const count = await store.increment(key, { by: cost, ttlMs: windowMs })
      const allowed = count <= max
      return { allowed, remaining: Math.max(0, max - count), retryAfterSeconds: allowed ? 0 : retryAfterSeconds }
    },
    async peek(identifier) {
      const { key, retryAfterSeconds } = await slot(identifier)
      const count = Number((await store.get(key)) ?? 0)
      const allowed = count < max
      return { allowed, remaining: Math.max(0, max - count), retryAfterSeconds: allowed ? 0 : retryAfterSeconds }
    },
    async reset(identifier) {
      const { key } = await slot(identifier)
      await store.delete?.(key)
    },
  }
}

/**
 * Brute-force protection for logins (and 2FA codes) that can't be turned
 * into a way to lock someone else out:
 *
 *   per account + IP   5 failures / 15 min   stops guessing one account
 *   per account        50 failures / hour    slows a botnet on one account
 *   per IP             100 failures / hour   slows credential stuffing
 *
 * Only failures count, and only check() is needed before the password is
 * verified. A victim logging in from their own IP is blocked only if
 * someone fails 50 times on their account within the hour, from many IPs.
 */
export function createLoginThrottle({ store = createMemoryCounterStore(), name = 'login', limits = {} } = {}) {
  const pair = createRateLimiter({ name: `${name}:pair`, store, max: limits.pair?.max ?? 5, window: limits.pair?.window ?? '15m' })
  const account = createRateLimiter({ name: `${name}:account`, store, max: limits.account?.max ?? 50, window: limits.account?.window ?? '1h' })
  const ip = createRateLimiter({ name: `${name}:ip`, store, max: limits.ip?.max ?? 100, window: limits.ip?.window ?? '1h' })

  const pairKey = (identifier, address) => `${String(identifier ?? '').trim().toLowerCase()}|${address}`

  return {
    /** Call before checking the password. */
    async check({ identifier, ip: address = 'unknown' }) {
      const results = await Promise.all([pair.peek(pairKey(identifier, address)), account.peek(identifier), ip.peek(address)])
      const blocked = results.filter((r) => !r.allowed)
      if (blocked.length === 0) return { allowed: true, retryAfterSeconds: 0 }
      return { allowed: false, retryAfterSeconds: Math.max(...blocked.map((r) => r.retryAfterSeconds)) }
    },
    /** Call after a wrong password (or unknown account). */
    async fail({ identifier, ip: address = 'unknown' }) {
      await Promise.all([pair.check(pairKey(identifier, address)), account.check(identifier), ip.check(address)])
    },
    /** Call after a successful login: clears this account+IP's failures. */
    async succeed({ identifier, ip: address = 'unknown' }) {
      await pair.reset(pairKey(identifier, address))
    },
  }
}
